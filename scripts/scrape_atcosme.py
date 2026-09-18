"""@cosmeから全ブランド・全商品を取得し、既存カタログに差分追加する。

- 旧 edit/ 一式と異なり、上位500ブランドへの絞り込みは行わない(全47,610ブランド対象)
- 既存の brand_id/name_id は一切変更しない(videos.jsonからの参照を壊さないため)
- 47,610ブランドのフル取得には数十時間かかるため、--time-budget 秒内で打ち切り、
  続きは scripts/atcosme_progress.json に記録して次回実行時に再開する
- サイトへの配慮として1リクエストごとに待機時間を挟む(lib/atcosme.py の REQUEST_DELAY)
"""

import argparse
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from lib.atcosme import fetch_sitemap_urls, scrape_one_brand

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "..", "src", "data")
BRANDS_JSON = os.path.join(DATA_DIR, "brands-list.json")
COSMETICS_JSON = os.path.join(DATA_DIR, "cosmetics_list.json")
PROGRESS_JSON = os.path.join(BASE_DIR, "atcosme_progress.json")

SAVE_EVERY_N_BRANDS = 25


def load_progress():
    if os.path.exists(PROGRESS_JSON):
        with open(PROGRESS_JSON, encoding="utf-8") as f:
            return json.load(f)
    print("初回実行: @cosmeのサイトマップを取得します（全ブランドURL一覧）")
    urls = fetch_sitemap_urls()
    print(f"サイトマップ取得完了: {len(urls)}件のブランドURL")
    return {"pending_urls": urls, "total_urls": len(urls), "done_count": 0}


def save_progress(progress):
    with open(PROGRESS_JSON, "w", encoding="utf-8") as f:
        json.dump(progress, f, ensure_ascii=False, indent=2)


def save_catalogs(brands, cosmetics_list):
    with open(BRANDS_JSON, "w", encoding="utf-8") as f:
        json.dump(brands, f, ensure_ascii=False, indent=2)
    with open(COSMETICS_JSON, "w", encoding="utf-8") as f:
        json.dump(cosmetics_list, f, ensure_ascii=False, indent=2)


def get_next_brand_num(brands: dict) -> int:
    max_num = 0
    for k in brands:
        m = re.match(r"brand-(\d+)$", k)
        if m:
            max_num = max(max_num, int(m.group(1)))
    return max_num + 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--time-budget", type=int, default=20100, help="このスクリプトが処理に使ってよい秒数の目安(デフォルト335分)"
    )
    args = parser.parse_args()

    progress = load_progress()
    with open(BRANDS_JSON, encoding="utf-8") as f:
        brands = json.load(f)
    with open(COSMETICS_JSON, encoding="utf-8") as f:
        cosmetics_list = json.load(f)

    name_to_brand_id = {v: k for k, v in brands.items()}
    next_brand_num = get_next_brand_num(brands)

    # brand_id -> 現在の最大name_id番号、(brand_id, name) -> key、
    # brand_id -> 既知の商品名集合、のインデックスを事前構築
    brand_max_name_num = {}
    pair_to_key = {}
    brand_known_names = {}
    for key, entry in cosmetics_list.items():
        bid = entry.get("brand_id")
        nid = entry.get("name_id", "")
        m = re.match(r"name-(\d+)$", nid)
        if bid and m:
            brand_max_name_num[bid] = max(brand_max_name_num.get(bid, 0), int(m.group(1)))
        if bid and entry.get("name"):
            pair_to_key[(bid, entry["name"])] = key
            brand_known_names.setdefault(bid, set()).add(entry["name"])

    def known_names_for_brand(brand_name):
        bid = name_to_brand_id.get(brand_name)
        return brand_known_names.get(bid) if bid else None

    start_time = time.time()
    new_brands = new_products = matched_existing = processed_this_run = 0

    while progress["pending_urls"]:
        if time.time() - start_time > args.time_budget:
            print("時間予算に達したため打ち切ります。続きは次回実行時に再開されます。")
            break

        url = progress["pending_urls"].pop(0)
        progress["done_count"] += 1
        processed_this_run += 1

        brand_name, products = scrape_one_brand(url, known_names_for_brand=known_names_for_brand)
        if not brand_name:
            continue

        if brand_name in name_to_brand_id:
            brand_id = name_to_brand_id[brand_name]
        else:
            brand_id = f"brand-{next_brand_num:05d}"
            brands[brand_id] = brand_name
            name_to_brand_id[brand_name] = brand_id
            next_brand_num += 1
            new_brands += 1
            print(f"[新規ブランド] {brand_id}: {brand_name}")

        for p in products:
            pair = (brand_id, p["name"])
            if pair in pair_to_key:
                # 既存商品: 何も上書きしない(brand_id/name_id/rakuten系/countはこのスクリプトの管轄外)
                matched_existing += 1
                continue

            next_name_num = brand_max_name_num.get(brand_id, 0) + 1
            name_id = f"name-{next_name_num:05d}"
            brand_max_name_num[brand_id] = next_name_num
            key = f"{brand_id}_{name_id}"
            cosmetics_list[key] = {
                "brand": brand_name,
                "brand_id": brand_id,
                "name": p["name"],
                "name_id": name_id,
                "category": p["category"],
                "amazon_link": "",
                "rakuten_image_link": "",
                "rakuten_text_link": "",
                "count": 0,
            }
            pair_to_key[pair] = key
            brand_known_names.setdefault(brand_id, set()).add(p["name"])
            new_products += 1

        if processed_this_run % SAVE_EVERY_N_BRANDS == 0:
            save_progress(progress)
            save_catalogs(brands, cosmetics_list)
            print(
                f"[進捗保存] {processed_this_run}件処理 / 残り{len(progress['pending_urls'])}件 "
                f"/ 新規ブランド{new_brands} / 新規商品{new_products} / 既存一致{matched_existing}"
            )

    save_progress(progress)
    save_catalogs(brands, cosmetics_list)

    print(
        f"\n=== 完了 === 今回処理: {processed_this_run}件 / 新規ブランド: {new_brands} "
        f"/ 新規商品: {new_products} / 既存一致: {matched_existing} / 残り: {len(progress['pending_urls'])}件"
    )


if __name__ == "__main__":
    main()
