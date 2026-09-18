"""【GitHub Actions実行用】scripts/pending/ に置かれた（ローカルで字幕取得済みの）動画を
Claudeで処理する。cookie/yt-dlpは一切使わないため、GitHub Actionsのクラウド環境で問題なく動く。

処理内容: ブランド/商品ペア抽出＋言及内容＋肌質推定（1回のAPI呼び出しに統合）
→ fuzzy matching＋LLMフォールバックのハイブリッドID照合 → videos.json更新 → 楽天API疎通確認。
"""

import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from lib.matching import resolve_brand, resolve_product

import requests
from pydantic import BaseModel

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "..", "src", "data")
VIDEOS_JSON = os.path.join(DATA_DIR, "videos.json")
BRANDS_JSON = os.path.join(DATA_DIR, "brands-list.json")
COSMETICS_JSON = os.path.join(DATA_DIR, "cosmetics_list.json")
PENDING_DIR = os.path.join(BASE_DIR, "pending")

ANTHROPIC_MODEL = "claude-haiku-4-5"
RAKUTEN_APP_ID = os.environ.get("RAKUTEN_APP_ID")


class MentionedCosmetic(BaseModel):
    brand: str
    product: str
    mentions: list[str]


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
    print("\n=== 楽天API疎通確認（動作確認のみ、全件取得はしない） ===")
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


def process_one(client, pending_path: str, videos: dict, brands: dict, cosmetics_list: dict):
    with open(pending_path, encoding="utf-8") as f:
        video = json.load(f)
    video_key = video["video_id"]
    transcript = video.pop("transcript")
    print(f"\n--- 処理対象: {video_key} - {video['title']} ---")

    print("Claudeで抽出（ブランド/商品ペア＋言及内容＋肌質、1呼び出しに統合）")
    extraction = extract_all(client, video["title"], transcript)
    print(f"抽出件数: {len(extraction.cosmetics)}")

    print("ブランド/商品IDのハイブリッド照合")
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
        resolved_cosmetics.append({
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
        })
        print(f"  解決: {official_brand} / {official_name}")

    video["skin_profile"] = extraction.skin_profile.model_dump()
    video["cosmetics"] = resolved_cosmetics
    video["processed"] = True
    video["check_status"] = len(resolved_cosmetics) > 0

    if resolved_cosmetics:
        rakuten_smoke_test(resolved_cosmetics[0]["name"])

    videos[video_key] = video
    print(f"完了: 登録コスメ数={len(resolved_cosmetics)} / check_status={video['check_status']}")


def main():
    pending_files = sorted(glob.glob(os.path.join(PENDING_DIR, "*.json")))
    if not pending_files:
        print("pendingファイルがありません。終了します。")
        return

    with open(VIDEOS_JSON, encoding="utf-8") as f:
        videos = json.load(f)
    with open(BRANDS_JSON, encoding="utf-8") as f:
        brands = json.load(f)
    with open(COSMETICS_JSON, encoding="utf-8") as f:
        cosmetics_list = json.load(f)

    from anthropic import Anthropic
    client = Anthropic()

    for pending_path in pending_files:
        process_one(client, pending_path, videos, brands, cosmetics_list)
        os.remove(pending_path)

    with open(VIDEOS_JSON, "w", encoding="utf-8") as f:
        json.dump(videos, f, ensure_ascii=False, indent=2)

    print(f"\n=== 全体完了 === 処理件数: {len(pending_files)}")


if __name__ == "__main__":
    main()
