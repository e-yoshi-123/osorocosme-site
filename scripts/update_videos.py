"""既存動画のメタデータ(タイトル・再生回数・登録者数・削除状態等)をYouTube Data APIで更新する。

GitHub Actions上での定期実行を想定。YOUTUBE_API_KEY は環境変数から読む(Secretsで注入)。
videos.list / channels.list をそれぞれ最大50件ずつバッチ取得することで、
1件ずつ呼んでいた旧実装(update_existing_video.py)よりAPIクォータ消費を大幅に削減している。
"""

import json
import os
import sys
import requests

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
VIDEOS_JSON = os.path.join(BASE_DIR, "..", "src", "data", "videos.json")

API_KEY = os.environ.get("YOUTUBE_API_KEY")
CHUNK_SIZE = 50


def chunked(seq, size):
    for i in range(0, len(seq), size):
        yield seq[i : i + size]


def fetch_videos_details(video_ids: list[str]) -> dict:
    result = {}
    for chunk in chunked(video_ids, CHUNK_SIZE):
        url = "https://www.googleapis.com/youtube/v3/videos"
        params = {"part": "snippet,statistics,status", "id": ",".join(chunk), "key": API_KEY}
        resp = requests.get(url, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        for item in data.get("items", []):
            result[item["id"]] = item
    return result


def fetch_channels_details(channel_ids: list[str]) -> dict:
    result = {}
    for chunk in chunked(channel_ids, CHUNK_SIZE):
        url = "https://www.googleapis.com/youtube/v3/channels"
        params = {"part": "snippet,statistics", "id": ",".join(chunk), "key": API_KEY}
        resp = requests.get(url, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        for item in data.get("items", []):
            result[item["id"]] = item
    return result


def main():
    if not API_KEY:
        print("YOUTUBE_API_KEY が設定されていません", file=sys.stderr)
        sys.exit(1)

    with open(VIDEOS_JSON, encoding="utf-8") as f:
        videos = json.load(f)

    video_ids = [v["video_id"] for v in videos.values() if v.get("video_id")]
    print(f"対象動画数: {len(video_ids)}")

    video_details = fetch_videos_details(video_ids)
    print(f"YouTube APIから取得できた動画: {len(video_details)}件")

    channel_ids = list({item["snippet"]["channelId"] for item in video_details.values()})
    channel_details = fetch_channels_details(channel_ids)
    print(f"チャンネル情報を取得: {len(channel_details)}件")

    updated_count = 0
    missing_count = 0

    for key, video in videos.items():
        video_id = video.get("video_id")
        item = video_details.get(video_id)

        if not item:
            # videos.list に一切返ってこない = 動画自体が削除された可能性が高い
            if not video.get("delete_flg"):
                video["delete_flg"] = True
                updated_count += 1
            missing_count += 1
            continue

        snippet = item["snippet"]
        statistics = item.get("statistics", {})
        status = item.get("status", {})
        privacy_status = status.get("privacyStatus")
        channel_id = snippet["channelId"]

        description = snippet.get("description", "")
        if len(description) > 100:
            description = description[:100] + "..."

        channel_item = channel_details.get(channel_id, {})
        channel_stats = channel_item.get("statistics", {})
        channel_snippet = channel_item.get("snippet", {})

        cosmetics = video.get("cosmetics")
        check_status = isinstance(cosmetics, list) and len(cosmetics) > 0

        video.update(
            {
                "title": snippet.get("title", video.get("title")),
                "description": description,
                "thumbnail": snippet.get("thumbnails", {}).get("medium", {}).get("url", video.get("thumbnail")),
                "published_at": snippet.get("publishedAt", video.get("published_at")),
                "channel_title": snippet.get("channelTitle", video.get("channel_title")),
                "channel_id": channel_id,
                "subscriber_count": channel_stats.get("subscriberCount", video.get("subscriber_count")),
                "channel_icon": channel_snippet.get("thumbnails", {}).get("default", {}).get("url", video.get("channel_icon")),
                "view_count": statistics.get("viewCount", video.get("view_count")),
                "check_status": check_status,
                "delete_flg": privacy_status in ("private", None),
            }
        )
        updated_count += 1

    with open(VIDEOS_JSON, "w", encoding="utf-8") as f:
        json.dump(videos, f, ensure_ascii=False, indent=2)

    print(f"\n=== 完了 === 更新: {updated_count}件 / API未返却(削除の可能性): {missing_count}件")


if __name__ == "__main__":
    main()
