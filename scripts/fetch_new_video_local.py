"""【ローカル専用】新着動画を1件見つけて字幕を取得し、pendingファイルとして保存する。

cookie認証によるYouTube非公式スクレイピングはGitHub Actionsのクラウドではbot判定でブロックされる
ことが実地検証で確認済み（Sign in to confirm you're not a botエラー、新鮮なcookieでも再現）。
そのため、cookieが必要なこの部分だけは住宅IPを持つローカル環境で実行し、
結果(動画メタデータ+字幕テキスト)をgit経由でGitHub Actionsに引き渡す設計にしている。

使い方: ローカルで `python3 scripts/fetch_new_video_local.py` を実行し、
生成された scripts/pending/{video_id}.json をcommit & pushする。
続きの処理(Claude抽出以降)は process_pending_videos.py がGitHub Actions上で行う。
"""

import json
import os
import re
import subprocess
import sys
import tempfile
from typing import Optional

import requests

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "..", "src", "data")
VIDEOS_JSON = os.path.join(DATA_DIR, "videos.json")
PENDING_DIR = os.path.join(BASE_DIR, "pending")

YOUTUBE_API_KEY = os.environ.get("YOUTUBE_API_KEY")
COOKIES_FILE = os.environ.get(
    "YOUTUBE_COOKIES_FILE", os.path.join(BASE_DIR, "..", "..", "youtube_cookies.txt")
)

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
        resp = requests.get(
            "https://www.googleapis.com/youtube/v3/search",
            params={
                "part": "snippet", "q": query, "type": "video", "order": "relevance",
                "maxResults": 10, "key": YOUTUBE_API_KEY,
            },
            timeout=30,
        )
        resp.raise_for_status()
        for item in resp.json().get("items", []):
            video_id = item["id"]["videoId"]
            if video_id in existing_video_ids:
                continue

            details = requests.get(
                "https://www.googleapis.com/youtube/v3/videos",
                params={"part": "contentDetails,statistics", "id": video_id, "key": YOUTUBE_API_KEY},
                timeout=30,
            ).json().get("items", [])
            if not details:
                continue
            if iso8601_duration_to_seconds(details[0]["contentDetails"].get("duration", "")) < MIN_DURATION_SEC:
                continue
            view_count = details[0]["statistics"].get("viewCount", "0")

            channel_id = item["snippet"]["channelId"]
            channels = requests.get(
                "https://www.googleapis.com/youtube/v3/channels",
                params={"part": "snippet,statistics", "id": channel_id, "key": YOUTUBE_API_KEY},
                timeout=30,
            ).json().get("items", [])
            if not channels:
                continue
            subscriber_count = int(channels[0]["statistics"].get("subscriberCount", "0"))
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
                "channel_icon": channels[0]["snippet"]["thumbnails"]["default"]["url"],
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
            "yt-dlp", "--cookies", COOKIES_FILE, "--write-auto-sub", "--skip-download",
            "--sub-lang", "ja", "--no-warnings", "--extractor-args", "youtube:player_client=android",
            "-o", out_template, f"https://www.youtube.com/watch?v={video_id}",
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        vtt_path = os.path.join(tmpdir, "video.ja.vtt")
        if not os.path.exists(vtt_path):
            print(f"  yt-dlp stderr: {result.stderr[-500:]}")
            return None
        with open(vtt_path, encoding="utf-8") as f:
            text = clean_vtt(f.read())
        return text if text.strip() else None


def main():
    if not YOUTUBE_API_KEY:
        print("環境変数 YOUTUBE_API_KEY が設定されていません。", file=sys.stderr)
        sys.exit(1)
    if not os.path.exists(COOKIES_FILE):
        print(f"cookieファイルが見つかりません: {COOKIES_FILE}", file=sys.stderr)
        sys.exit(1)

    with open(VIDEOS_JSON, encoding="utf-8") as f:
        videos = json.load(f)
    existing_ids = {v.get("video_id") for v in videos.values()}

    print("=== 新着動画を検索 ===")
    new_video = find_new_video(existing_ids)
    if not new_video:
        print("条件に合う新着動画が見つかりませんでした。")
        sys.exit(0)
    video_id = new_video["video_id"]
    print(f"発見: {video_id} - {new_video['title']}")

    print("\n=== 字幕取得（cookie認証、ローカル実行のみ） ===")
    transcript = fetch_transcript(video_id)
    if not transcript:
        print("字幕が取得できませんでした。pendingには保存しません。")
        sys.exit(1)
    print(f"取得成功: {len(transcript)}文字")

    os.makedirs(PENDING_DIR, exist_ok=True)
    pending_path = os.path.join(PENDING_DIR, f"{video_id}.json")
    with open(pending_path, "w", encoding="utf-8") as f:
        json.dump({**new_video, "transcript": transcript}, f, ensure_ascii=False, indent=2)

    print(f"\n=== 完了 === {pending_path} に保存しました。")
    print("このファイルをcommit & pushし、GitHub ActionsでClaude処理を実行してください。")


if __name__ == "__main__":
    main()
