"""楽天リンクの取得・更新（旧 rakuten_link_get.py + rakuten_link_update.py 相当）。

対象は「動画で実際に使われている(count>=1)」cosmetics_listエントリのみ（未使用の約29,000件は対象外）。
以下の2種類を再取得する:
  1. rakuten_text_linkが空のもの（未取得）
  2. rakuten_text_linkはあるが、実際にアクセスすると失敗する（リンク切れ）もの

1回の実行で処理する件数は --limit で制限する（楽天APIへの配慮、GitHub Actionsの実行時間対策）。
未処理分は次回実行時に続きから処理されるよう、優先度順（未取得→リンク切れ）に処理する。
"""

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from lib.rakuten import get_rakuten_item_info, is_link_alive, RakutenAPIUnavailable

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "..", "src", "data")
COSMETICS_JSON = os.path.join(DATA_DIR, "cosmetics_list.json")
VIDEOS_JSON = os.path.join(DATA_DIR, "videos.json")

SLEEP_SECONDS = 1.0  # 楽天APIへの配慮


def propagate_to_videos(videos: dict, updated_keys: dict) -> int:
    """cosmetics_listの更新結果を、videos.json内の該当cosmetics[]にも反映する（旧rakuten_link_update.py相当）。"""
    count = 0
    for video in videos.values():
        for cosmetic in video.get("cosmetics") or []:
            if not isinstance(cosmetic, dict):
                continue
            key = f"{cosmetic.get('brand_id')}_{cosmetic.get('name_id')}"
            if key in updated_keys:
                new_data = updated_keys[key]
                if new_data.get("rakuten_image_link"):
                    cosmetic["rakuten_image_link"] = new_data["rakuten_image_link"]
                if new_data.get("rakuten_text_link"):
                    cosmetic["rakuten_text_link"] = new_data["rakuten_text_link"]
                if new_data.get("now_price") is not None:
                    cosmetic["now_price"] = new_data["now_price"]
                count += 1
    return count


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=100, help="1回の実行で処理する最大件数")
    parser.add_argument("--check-existing", type=int, default=30, help="既存リンクの生存確認に使う最大件数(limit内)")
    args = parser.parse_args()

    with open(COSMETICS_JSON, encoding="utf-8") as f:
        cosmetics_list = json.load(f)

    used_items = {k: v for k, v in cosmetics_list.items() if v.get("count", 0) >= 1}
    missing = [(k, v) for k, v in used_items.items() if not v.get("rakuten_text_link")]
    existing = [(k, v) for k, v in used_items.items() if v.get("rakuten_text_link")]

    print(f"対象(count>=1): {len(used_items)}件 / リンク未取得: {len(missing)}件 / リンクあり: {len(existing)}件")

    updated_keys = {}
    processed = 0
    api_down = False

    # 1. 未取得分を優先して処理
    for key, entry in missing:
        if processed >= args.limit:
            break
        brand, name = entry.get("brand", ""), entry.get("name", "")
        product_name = f"{brand} {name}"
        try:
            image_html, link, price = get_rakuten_item_info(product_name)
        except RakutenAPIUnavailable as e:
            print(f"[楽天API利用不可] {e} — 今回はここで打ち切ります（未確定分は次回リトライ）")
            api_down = True
            break
        if image_html and link:
            entry["rakuten_image_link"] = image_html
            entry["rakuten_text_link"] = link
            entry["now_price"] = price
            entry.pop("rakuten_link_none", None)
            updated_keys[key] = entry
            print(f"[取得] {product_name} -> 価格{price}円")
        else:
            entry["rakuten_link_none"] = True
            print(f"[見つからず] {product_name}")
        processed += 1
        time.sleep(SLEEP_SECONDS)

    # 2. 残り枠で既存リンクの生存確認→リンク切れのみ再取得
    checked = 0
    if not api_down:
        for key, entry in existing:
            if processed >= args.limit or checked >= args.check_existing:
                break
            checked += 1
            link = entry["rakuten_text_link"]
            if is_link_alive(link):
                continue

            brand, name = entry.get("brand", ""), entry.get("name", "")
            product_name = f"{brand} {name}"
            print(f"[リンク切れ検出] {product_name} ({link})")
            try:
                image_html, new_link, price = get_rakuten_item_info(product_name)
            except RakutenAPIUnavailable as e:
                print(f"[楽天API利用不可] {e} — 今回はここで打ち切ります（未確定分は次回リトライ）")
                api_down = True
                break
            if image_html and new_link:
                entry["rakuten_image_link"] = image_html
                entry["rakuten_text_link"] = new_link
                entry["now_price"] = price
                entry.pop("rakuten_link_none", None)
                updated_keys[key] = entry
                print(f"  再取得成功 -> 価格{price}円")
            else:
                entry["rakuten_link_none"] = True
                print("  再取得も失敗、rakuten_link_none を設定")
            processed += 1
            time.sleep(SLEEP_SECONDS)

    with open(COSMETICS_JSON, "w", encoding="utf-8") as f:
        json.dump(cosmetics_list, f, ensure_ascii=False, indent=2)

    if updated_keys:
        with open(VIDEOS_JSON, encoding="utf-8") as f:
            videos = json.load(f)
        propagated = propagate_to_videos(videos, updated_keys)
        with open(VIDEOS_JSON, "w", encoding="utf-8") as f:
            json.dump(videos, f, ensure_ascii=False, indent=2)
        print(f"\nvideos.json内の該当コスメ {propagated}箇所にも反映しました。")

    print(f"\n=== 完了 === 処理件数: {processed} / 更新件数: {len(updated_keys)}")


if __name__ == "__main__":
    main()
