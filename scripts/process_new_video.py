"""試験パイプライン: 新着動画を1件見つけ、字幕取得→Claudeでコスメ抽出→
ブランド/商品IDのハイブリッド照合→言及抽出→肌質推定→楽天APIの疎通確認、までを1本で実行する。

これは「実際に1件通してみる」ための試験実装。楽天リンク取得は全件処理すると時間がかかるため、
接続確認(1回のAPI呼び出し)のみ行い、cosmetics_listへの反映は行わない。
"""

import json
import os
from typing import Optional
import re
import subprocess
import sys
import tempfile

import requests
from pydantic import BaseModel

sys.path.insert(0, os.path.dirname(__file__))
from lib.matching import resolve_brand, resolve_product

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "..", "src", "data")
VIDEOS_JSON = os.path.join(DATA_DIR, "videos.json")
BRANDS_JSON = os.path.join(DATA_DIR, "brands-list.json")
COSMETICS_JSON = os.path.join(DATA_DIR, "cosmetics_list.json")

YOUTUBE_API_KEY = os.environ.get("YOUTUBE_API_KEY")
ANTHROPIC_MODEL = "claude-haiku-4-5"
COOKIES_FILE = os.environ.get("YOUTUBE_COOKIES_FILE")
RAKUTEN_APP_ID = os.environ.get("RAKUTEN_APP_ID")

SEARCH_QUERIES = ["毎日メイク", "コスメ", "スキンケア"]
MIN_SUBSCRIBERS = 3000
MIN_DURATION_SEC = 70


def iso8601_duration_to_seconds(duration: str) -> int:
    m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", duration)
    if not m:
        return 0
    h, mi, s = (int(x) if x else 0 for x in m.groups())
    return h * 3600 + mi * 60 + s


def find_new_video(existing_video_ids: set) -> Optional[dict]:
    for query in SEARCH_QUERIES:
        url = "https://www.googleapis.com/youtube/v3/search"
        params = {
            "part": "snippet",
            "q": query,
            "type": "video",
            "order": "relevance",
            "maxResults": 10,
            "key": YOUTUBE_API_KEY,
        }
        resp = requests.get(url, params=params, timeout=30)
        resp.raise_for_status()
        items = resp.json().get("items", [])

        for item in items:
            video_id = item["id"]["videoId"]
            if video_id in existing_video_ids:
                continue

            details_resp = requests.get(
                "https://www.googleapis.com/youtube/v3/videos",
                params={"part": "contentDetails,statistics", "id": video_id, "key": YOUTUBE_API_KEY},
                timeout=30,
            )
            details_items = details_resp.json().get("items", [])
            if not details_items:
                continue
            duration = details_items[0]["contentDetails"].get("duration", "")
            if iso8601_duration_to_seconds(duration) < MIN_DURATION_SEC:
                continue
            view_count = details_items[0]["statistics"].get("viewCount", "0")

            channel_id = item["snippet"]["channelId"]
            channel_resp = requests.get(
                "https://www.googleapis.com/youtube/v3/channels",
                params={"part": "snippet,statistics", "id": channel_id, "key": YOUTUBE_API_KEY},
                timeout=30,
            )
            channel_items = channel_resp.json().get("items", [])
            if not channel_items:
                continue
            subscriber_count = int(channel_items[0]["statistics"].get("subscriberCount", "0"))
            if subscriber_count < MIN_SUBSCRIBERS:
                continue

            description = item["snippet"].get("description", "")
            if len(description) > 100:
                description = description[:100] + "..."

            return {
                "video_id": video_id,
                "title": item["snippet"]["title"],
                "description": description,
                "thumbnail": item["snippet"]["thumbnails"]["medium"]["url"],
                "url": f"https://www.youtube.com/watch?v={video_id}",
                "published_at": item["snippet"]["publishedAt"],
                "channel_title": item["snippet"]["channelTitle"],
                "channel_id": channel_id,
                "channel_icon": channel_items[0]["snippet"]["thumbnails"]["default"]["url"],
                "subscriber_count": subscriber_count,
                "view_count": view_count,
                "check_status": False,
                "delete_flg": False,
                "processed": False,
            }
    return None


def clean_vtt(vtt_text: str) -> str:
    lines = vtt_text.splitlines()
    texts, seen = [], set()
    for line in lines:
        line = line.strip()
        if not line or line.startswith("WEBVTT") or line.startswith("Kind:") or line.startswith("Language:"):
            continue
        if "-->" in line or re.match(r"^\d+$", line):
            continue
        clean = re.sub(r"<[^>]+>", "", line).strip()
        if clean and clean not in seen:
            texts.append(clean)
            seen.add(clean)
    return "\n".join(texts)


def fetch_transcript(video_id: str) -> Optional[str]:
    with tempfile.TemporaryDirectory() as tmpdir:
        out_template = os.path.join(tmpdir, "video.%(ext)s")
        cmd = [
            "yt-dlp",
            "--cookies", COOKIES_FILE,
            "--write-auto-sub",
            "--skip-download",
            "--sub-lang", "ja",
            "--no-warnings",
            "--extractor-args", "youtube:player_client=android",
            "-o", out_template,
            f"https://www.youtube.com/watch?v={video_id}",
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        vtt_path = os.path.join(tmpdir, "video.ja.vtt")
        if not os.path.exists(vtt_path):
            print(f"  yt-dlp stderr: {result.stderr[-500:]}")
            return None
        with open(vtt_path, encoding="utf-8") as f:
            text = clean_vtt(f.read())
        return text if text.strip() else None


class MentionedCosmetic(BaseModel):
    brand: str
    product: str
    mentions: list[str]  # 言及内容の箇条書き。無ければ空リスト


class SkinProfile(BaseModel):
    イエベ春: bool
    イエベ秋: bool
    ブルベ夏: bool
    ブルベ冬: bool
    乾燥肌: bool
    脂性肌: bool
    混合肌: bool
    敏感肌: bool
    普通肌: bool


class CombinedExtraction(BaseModel):
    cosmetics: list[MentionedCosmetic]
    skin_profile: SkinProfile


def extract_all(client, title: str, transcript: str) -> CombinedExtraction:
    """ブランド/商品ペア抽出・言及内容抽出・肌質推定を1回のAPI呼び出しにまとめる。

    旧実装(regist-chatgpt-firebase-transcript.py / regist-cosme-mention.py / register_skin_profile.py)
    はこの3つを別々に呼び、同じtranscriptを3回送信していた（セクション11-3で指摘した非効率）。
    ここでは1回にまとめ、transcriptの送信を1回分に削減している。
    """
    prompt = f"""以下はYouTube動画のタイトルとトランスクリプトです。次の2つを一度に抽出してください。

1. 言及されているコスメのブランド名・商品名のペアと、それぞれについて動画内でどう言及されていたか
   （使用理由・仕上がり・使い心地など）を箇条書きで。言及内容が無ければ空リストでよい。
2. 内容から読み取れる「パーソナルカラー」と「肌質」。抽出できなければ無理にtrueにせず全てfalseにする。

【動画タイトル】
{title}

【トランスクリプト】
{transcript}
"""
    response = client.messages.parse(
        model=ANTHROPIC_MODEL, max_tokens=2500, messages=[{"role": "user", "content": prompt}], output_format=CombinedExtraction
    )
    return response.parsed_output


def rakuten_smoke_test(keyword: str):
    print(f"\n=== 楽天API疎通確認（動作確認のみ、全件取得はしない） ===")
    if not RAKUTEN_APP_ID:
        print("  RAKUTEN_APP_ID未設定のためスキップ")
        return
    try:
        resp = requests.get(
            "https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706",
            params={"applicationId": RAKUTEN_APP_ID, "keyword": keyword, "hits": 1},
            timeout=15,
        )
        data = resp.json()
        if "Items" in data and data["Items"]:
            item = data["Items"][0]["Item"]
            print(f"  OK: HTTP {resp.status_code} / 該当件数 {data.get('count')} / 例: {item.get('itemName')}")
        else:
            print(f"  応答はあったが該当商品なし: {data}")
    except Exception as e:
        print(f"  楽天API呼び出し失敗: {e}")


def main():
    with open(VIDEOS_JSON, encoding="utf-8") as f:
        videos = json.load(f)
    with open(BRANDS_JSON, encoding="utf-8") as f:
        brands = json.load(f)
    with open(COSMETICS_JSON, encoding="utf-8") as f:
        cosmetics_list = json.load(f)

    existing_ids = {v.get("video_id") for v in videos.values()}

    print("=== 1. 新着動画を検索 ===")
    new_video = find_new_video(existing_ids)
    if not new_video:
        print("条件に合う新着動画が見つかりませんでした。終了します。")
        return
    video_key = new_video["video_id"]
    print(f"発見: {video_key} - {new_video['title']}")

    print("\n=== 2. 字幕取得（cookie認証） ===")
    transcript = fetch_transcript(video_key)
    if not transcript:
        print("字幕が取得できませんでした。動画だけ登録して終了します。")
        videos[video_key] = new_video
        with open(VIDEOS_JSON, "w", encoding="utf-8") as f:
            json.dump(videos, f, ensure_ascii=False, indent=2)
        return
    print(f"取得成功: {len(transcript)}文字")

    from anthropic import Anthropic

    client = Anthropic()

    print("\n=== 3. Claudeで抽出（ブランド/商品ペア＋言及内容＋肌質、1呼び出しに統合） ===")
    extraction = extract_all(client, new_video["title"], transcript)
    print(f"抽出件数: {len(extraction.cosmetics)}")
    for c in extraction.cosmetics:
        print(f"  - {c.brand} / {c.product} (言及{len(c.mentions)}件)")

    print("\n=== 4. ブランド/商品IDのハイブリッド照合 ===")
    resolved_cosmetics = []
    for c in extraction.cosmetics:
        brand_id, official_brand = resolve_brand(client, ANTHROPIC_MODEL, c.brand, brands)
        if not brand_id:
            print(f"  未解決(ブランド): {c.brand}")
            continue
        name_id, official_name = resolve_product(client, ANTHROPIC_MODEL, c.product, brand_id, cosmetics_list)
        if not name_id:
            print(f"  未解決(商品): {c.brand}/{c.product}")
            continue
        cat_entry = cosmetics_list.get(f"{brand_id}_{name_id}", {})
        resolved_cosmetics.append(
            {
                "brand_id": brand_id,
                "brand": official_brand,
                "name_id": name_id,
                "name": official_name,
                "related_tags": [cat_entry.get("category")] if cat_entry.get("category") else [],
                "skin_concern": "",
                "rakuten_image_link": "",
                "rakuten_text_link": "",
                "amazon_link": "",
                "mentions": c.mentions,
            }
        )
        print(f"  解決: {official_brand} / {official_name}")

    new_video["skin_profile"] = extraction.skin_profile.model_dump()

    if resolved_cosmetics:
        rakuten_smoke_test(resolved_cosmetics[0]["name"])
    else:
        print("\n解決済みコスメが0件のため、楽天疎通確認はスキップします。")

    new_video["cosmetics"] = resolved_cosmetics
    new_video["processed"] = True
    new_video["check_status"] = len(resolved_cosmetics) > 0

    videos[video_key] = new_video
    with open(VIDEOS_JSON, "w", encoding="utf-8") as f:
        json.dump(videos, f, ensure_ascii=False, indent=2)

    print(f"\n=== 完了 === video_key={video_key} / 登録コスメ数={len(resolved_cosmetics)} / check_status={new_video['check_status']}")


if __name__ == "__main__":
    main()
