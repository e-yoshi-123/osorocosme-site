"""楽天リンクの取得・更新（旧 rakuten_link_get.py + rakuten_link_update.py 相当）。

対象は「動画で実際に使われている(count>=1)」cosmetics_listエントリのみ（未使用の約29,000件は対象外）。
以下の2種類を再取得する:
  1. rakuten_text_linkが空のもの（未取得）
  2. rakuten_text_linkはあるが、実際にアクセスすると失敗する（リンク切れ）もの

紹介動画数(count)が多いものほど影響が大きいため、未取得/リンク切れを区別せずcount降順の
単一優先度リストとして楽天APIへの問い合わせを行う（動画数が多いコスメのリンク切れほど早く直す）。

2段階構成:
  フェーズ1: 既存リンクの生存確認。1件あたり楽天側のリダイレクトに約10秒かかるため、
             スレッドプールで並列に行う（順次だと1945件で5時間超かかるため）。
             進捗はrakuten_liveness_progress.jsonに随時保存され、中断後の再実行では
             チェック済みのkeyをスキップして続きから再開する（全件完了時に自動削除）。
  フェーズ2: 未取得分 + フェーズ1で判明したリンク切れ分をcount降順で楽天APIに問い合わせる。
             こちらは楽天APIのレート制限に配慮し、逐次実行+スリープを維持する。

1回の実行で楽天APIへ実際に問い合わせる（＝新規取得または再取得）件数は --limit で制限する
（楽天APIへの配慮、GitHub Actionsの実行時間対策）。

長時間実行中に中断されても直前までの成果を失わないよう、一定件数ごとに
cosmetics_list.json / videos.json への保存（チェックポイント、一時ファイル経由の安全な書き込み）を行う。
"""

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(__file__))
from lib.rakuten import get_rakuten_item_info, is_link_alive, RakutenAPIUnavailable

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "..", "src", "data")
COSMETICS_JSON = os.path.join(DATA_DIR, "cosmetics_list.json")
VIDEOS_JSON = os.path.join(DATA_DIR, "videos.json")
LIVENESS_PROGRESS_JSON = os.path.join(BASE_DIR, "rakuten_liveness_progress.json")

SLEEP_SECONDS = 1.0  # 楽天APIへの配慮
CHECKPOINT_EVERY = 20  # この件数ごとに中間保存する
LIVENESS_CHECK_WORKERS = 10  # 生存確認の並列数（1件約10秒かかるため並列化）
LIVENESS_SAVE_EVERY = 50  # 生存確認の進捗をこの件数ごとに保存する


def atomic_write_json(path: str, data) -> None:
    """中断時にファイルが壊れないよう、一時ファイルに書いてから置き換える。"""
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


def propagate_to_videos(updated_keys: dict) -> int:
    """cosmetics_listの更新結果を、videos.json内の該当cosmetics[]にも反映する（旧rakuten_link_update.py相当）。"""
    if not updated_keys:
        return 0
    with open(VIDEOS_JSON, encoding="utf-8") as f:
        videos = json.load(f)

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

    atomic_write_json(VIDEOS_JSON, videos)
    return count


def save_checkpoint(cosmetics_list: dict, updated_keys: dict, liveness_progress: dict, label: str):
    atomic_write_json(COSMETICS_JSON, cosmetics_list)
    atomic_write_json(LIVENESS_PROGRESS_JSON, liveness_progress)
    propagated = propagate_to_videos(updated_keys)
    print(f"--- {label}（更新{len(updated_keys)}件、videos.json反映{propagated}箇所） ---", flush=True)


def load_liveness_progress() -> dict:
    """中断・再開に備えた生存確認の進捗（key -> alive(bool)）を読み込む。"""
    if os.path.exists(LIVENESS_PROGRESS_JSON):
        with open(LIVENESS_PROGRESS_JSON, encoding="utf-8") as f:
            return json.load(f)
    return {}


def check_liveness_parallel(items_with_links: list, progress: dict) -> None:
    """(key, link) のうちprogress未登録のものだけ並列に生存確認し、progressに随時追記・保存する。

    中断されても、次回起動時にprogressへ既に記録済みのkeyはスキップされるため、
    約30分かかる全件チェックをやり直さずに続きから再開できる。
    """
    remaining = [(k, link) for k, link in items_with_links if k not in progress]
    total = len(items_with_links)
    skip_count = total - len(remaining)
    if skip_count:
        print(f"  {skip_count}件は前回チェック済みのためスキップ、残り{len(remaining)}件を確認します", flush=True)
    if not remaining:
        return

    done = 0
    with ThreadPoolExecutor(max_workers=LIVENESS_CHECK_WORKERS) as executor:
        future_to_key = {
            executor.submit(is_link_alive, link): key for key, link in remaining
        }
        for future in as_completed(future_to_key):
            key = future_to_key[future]
            done += 1
            progress[key] = future.result()
            if done % LIVENESS_SAVE_EVERY == 0 or done == len(remaining):
                atomic_write_json(LIVENESS_PROGRESS_JSON, progress)
                broken_so_far = sum(1 for v in progress.values() if not v)
                print(
                    f"  生存確認 {skip_count + done}/{total}件完了・保存済み"
                    f"（累計リンク切れ検出: {broken_so_far}件）",
                    flush=True,
                )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--limit", type=int, default=100,
        help="1回の実行で楽天APIに実際に問い合わせる（新規取得+リンク切れ再取得）最大件数",
    )
    args = parser.parse_args()

    with open(COSMETICS_JSON, encoding="utf-8") as f:
        cosmetics_list = json.load(f)

    used_items = {k: v for k, v in cosmetics_list.items() if v.get("count", 0) >= 1}
    sorted_items = sorted(used_items.items(), key=lambda kv: kv[1].get("count", 0), reverse=True)
    total = len(sorted_items)

    missing_keys = [k for k, v in sorted_items if not v.get("rakuten_text_link")]
    existing_pairs = [(k, v["rakuten_text_link"]) for k, v in sorted_items if v.get("rakuten_text_link")]

    print(f"対象(count>=1): {total}件 / リンク未取得: {len(missing_keys)}件 / リンクあり: {len(existing_pairs)}件")

    print(f"\n=== フェーズ1: 既存{len(existing_pairs)}件の生存確認（並列{LIVENESS_CHECK_WORKERS}件） ===", flush=True)
    liveness_progress = load_liveness_progress()
    check_liveness_parallel(existing_pairs, liveness_progress)
    broken_keys = {k for k, alive in liveness_progress.items() if not alive}
    print(f"生存確認完了: リンク切れ {len(broken_keys)}件", flush=True)

    need_fetch_keys = set(missing_keys) | broken_keys
    fetch_targets = [(k, v) for k, v in sorted_items if k in need_fetch_keys]
    fetch_total = len(fetch_targets)

    print(f"\n=== フェーズ2: 未取得+リンク切れ 計{fetch_total}件を紹介動画数の多い順に取得（上限{args.limit}件） ===\n", flush=True)

    updated_keys = {}
    processed = 0  # 楽天APIへの実問い合わせ件数（=limitで制御される数）
    api_down = False
    limit_reached = False

    for i, (key, entry) in enumerate(fetch_targets, start=1):
        if processed >= args.limit:
            print(f"\n上限({args.limit}件)に到達したため打ち切ります（残りは次回実行）")
            limit_reached = True
            break

        brand, name = entry.get("brand", ""), entry.get("name", "")
        product_name = f"{brand} {name}"
        video_count = entry.get("count", 0)
        reason = "未取得" if key in missing_keys else "リンク切れ"
        print(f"[{i}/{fetch_total}] (紹介数{video_count}, {reason}) {product_name} を検索中...", flush=True)

        try:
            image_html, new_link, price = get_rakuten_item_info(brand, name)
        except RakutenAPIUnavailable as e:
            print(f"[楽天API利用不可] {e} — 今回はここで打ち切ります（未確定分は次回リトライ）")
            api_down = True
            break

        # このkeyの生存確認記録は結果が確定した時点で古くなるため、必ず一旦破棄する
        # （破棄しないと、直した後も「前回チェック済み＝リンク切れ」のまま扱われ、
        #   直したはずの商品が延々と再取得され続けるバグになる）
        liveness_progress.pop(key, None)

        if image_html and new_link:
            entry["rakuten_image_link"] = image_html
            entry["rakuten_text_link"] = new_link
            entry["now_price"] = price
            entry.pop("rakuten_link_none", None)
            updated_keys[key] = entry
            liveness_progress[key] = True  # 取得直後のリンクなので生存確認済み扱いにする
            print(f"  [取得] {product_name} -> 価格{price}円", flush=True)
        else:
            entry["rakuten_link_none"] = True
            print(f"  [見つからず] {product_name}", flush=True)

        processed += 1
        if processed % CHECKPOINT_EVERY == 0:
            save_checkpoint(cosmetics_list, updated_keys, liveness_progress, f"チェックポイント保存（API問い合わせ{processed}件時点）")
        time.sleep(SLEEP_SECONDS)

    save_checkpoint(cosmetics_list, updated_keys, liveness_progress, "最終保存")

    if not api_down and not limit_reached and os.path.exists(LIVENESS_PROGRESS_JSON):
        os.remove(LIVENESS_PROGRESS_JSON)
        print("全件処理が完了したため、生存確認の進捗ファイルを削除しました。", flush=True)

    print(f"\n=== 完了 === API問い合わせ件数: {processed} / 更新件数: {len(updated_keys)}")


if __name__ == "__main__":
    main()
