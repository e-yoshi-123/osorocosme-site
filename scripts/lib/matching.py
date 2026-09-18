"""ブランド名・商品名のハイブリッド照合（fuzzy matching優先、閾値未達分のみLLMフォールバック）。

セクション14の設計を踏襲: あいまい文字列マッチング単独では `ロムアンド`→`rom&nd` のような
表記変換ケースを取りこぼすため、まずdifflibで試し、閾値に届かなかったものだけ
Claudeに公式名リストを渡して意味的に照合する。
"""

import difflib
import json
from typing import Optional


BRAND_THRESHOLD = 0.85
PRODUCT_THRESHOLD = 0.75


def best_match(query: str, candidates: list[str]) -> tuple[Optional[str], float]:
    best = None
    best_score = -1.0
    for c in candidates:
        score = difflib.SequenceMatcher(None, query, c).ratio()
        if score > best_score:
            best_score = score
            best = c
    return best, best_score


def resolve_brand(client, model: str, extracted_brand: str, brands: dict[str, str]) -> tuple[Optional[str], str]:
    """extracted_brand -> (brand_id, official_name) を返す。見つからなければ (None, "")。"""
    names = list(brands.values())
    ids = list(brands.keys())
    match_name, score = best_match(extracted_brand, names)
    if match_name and score >= BRAND_THRESHOLD:
        return ids[names.index(match_name)], match_name

    # フォールバック: Claudeに公式ブランド名リストを渡して意味的に照合させる
    from pydantic import BaseModel

    class BrandMatch(BaseModel):
        brand_id: Optional[str]
        official_name: Optional[str]

    # ブランド一覧は動画・呼び出しが変わっても内容が同じ固定データなので、
    # Prompt Cachingで繰り返し送信時のコストを抑える（バルク処理時に効果が出る設計）。
    brand_list_json = json.dumps([{"brand_id": k, "name": v} for k, v in brands.items()], ensure_ascii=False)
    try:
        response = client.messages.parse(
            model=model,
            max_tokens=200,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": f"【公式ブランド一覧】\n{brand_list_json}",
                            "cache_control": {"type": "ephemeral"},
                        },
                        {
                            "type": "text",
                            "text": f"""以下は動画から抽出されたブランド名です: 「{extracted_brand}」

これは日本語の発音表記や表記ゆれの可能性があります(例: 「ロムアンド」の正式表記は「rom&nd」)。
上記の公式ブランド一覧の中に対応するものがあれば brand_id と official_name(一覧内の表記そのまま)を返してください。
該当するものが無ければ両方nullにしてください。""",
                        },
                    ],
                }
            ],
            output_format=BrandMatch,
        )
        result = response.parsed_output
        if result.brand_id and result.brand_id in brands:
            return result.brand_id, brands[result.brand_id]
    except Exception as e:
        print(f"  [warn] ブランドLLM照合失敗: {e}")
    return None, ""


def resolve_product(client, model: str, extracted_name: str, brand_id: str, cosmetics_list: dict) -> tuple[Optional[str], str]:
    """同一brand_id内の商品からextracted_nameに対応するname_idを探す。"""
    candidates = {k: v for k, v in cosmetics_list.items() if v.get("brand_id") == brand_id}
    names = [v["name"] for v in candidates.values()]
    name_ids = [v["name_id"] for v in candidates.values()]

    if names:
        match_name, score = best_match(extracted_name, names)
        if match_name and score >= PRODUCT_THRESHOLD:
            return name_ids[names.index(match_name)], match_name

    if not candidates:
        return None, ""

    from pydantic import BaseModel

    class ProductMatch(BaseModel):
        name_id: Optional[str]
        official_name: Optional[str]

    # 同一ブランド内の商品一覧も、同じブランドの別動画・別呼び出しで繰り返し使われるためキャッシュ対象にする。
    product_list_json = json.dumps(
        [{"name_id": v["name_id"], "name": v["name"]} for v in candidates.values()], ensure_ascii=False
    )
    try:
        response = client.messages.parse(
            model=model,
            max_tokens=200,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": f"【登録済み商品一覧】\n{product_list_json}",
                            "cache_control": {"type": "ephemeral"},
                        },
                        {
                            "type": "text",
                            "text": f"""以下は動画から抽出された商品名です: 「{extracted_name}」

上記はこのブランドの登録済み商品一覧です。対応するものがあれば name_id と official_name を返してください。
無ければ両方nullにしてください。""",
                        },
                    ],
                }
            ],
            output_format=ProductMatch,
        )
        result = response.parsed_output
        if result.name_id and any(v["name_id"] == result.name_id for v in candidates.values()):
            return result.name_id, result.official_name or ""
    except Exception as e:
        print(f"  [warn] 商品LLM照合失敗: {e}")
    return None, ""
