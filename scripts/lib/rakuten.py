"""楽天市場 商品検索API(IchibaItem/Search)のラッパー。旧codes/rakuten_link_get.pyのロジックを踏襲。

2026-09-18の実地検証で判明した新API(20260401)の癖:
  1. 1文字だけの単語(例:「ザ」)がクエリに含まれると"keyword is not valid"(400)で弾かれる
  2. ブランド名を含めると、期待に反してヒットしないケースが多い
     (例: "セザンヌ 極細 アイライナーR"は0件、"極細 アイライナーR"は95件)
これを踏まえ、複数パターンを段階的に試すフォールバック方式にしている。
"""

import os
import time
import requests

RAKUTEN_APP_ID = os.environ.get("RAKUTEN_APP_ID")
RAKUTEN_ACCESS_KEY = os.environ.get("RAKUTEN_ACCESS_KEY")
RAKUTEN_AFFILIATE_ID = os.environ.get("RAKUTEN_AFFILIATE_ID")
# 2026-05-13に旧エンドポイント(app.rakuten.co.jp/services/api)が完全廃止されたため、
# 新エンドポイント(openapi.rakuten.co.jp/ichibams/api)+accessKey認証に移行済み。
SEARCH_URL = "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401"


def simplify_product_name(product_name: str) -> str:
    """重複語を削除する（楽天API対策、旧実装を踏襲）。"""
    words = product_name.split()
    seen = set()
    simplified = []
    for word in words:
        if word not in seen:
            simplified.append(word)
            seen.add(word)
    return " ".join(simplified)


def _remove_short_tokens(text: str) -> str:
    """1文字だけの単語は新APIで"keyword is not valid"の原因になるため除去する。"""
    return " ".join(w for w in text.split() if len(w) >= 2)


def build_query_candidates(brand: str, name: str) -> list[str]:
    """ヒット率を上げるため、具体的なものから緩いものへ段階的に試すクエリ候補を作る。
    実地検証の結果、ブランド名を含めると逆にヒットしないケースが多かったため、
    「ブランド+商品名」より先に「商品名のみ」を優先する。"""
    candidates = []

    product_only = _remove_short_tokens(simplify_product_name(name))
    if product_only:
        candidates.append(product_only)

    no_space = product_only.replace(" ", "")
    if no_space and no_space != product_only:
        candidates.append(no_space)

    combined = _remove_short_tokens(simplify_product_name(f"{brand} {name}"))
    if combined and combined not in candidates:
        candidates.append(combined)

    return candidates


class RakutenAPIUnavailable(Exception):
    """楽天API自体が一時的に利用できない状態（メンテナンス・5xx・通信エラー等）。
    「該当商品が見つからなかった」とは区別し、rakuten_link_noneは立てずにリトライ対象として扱う。"""


def _brand_matches(brand: str, item: dict) -> bool:
    """検索結果が本当に該当ブランドの商品か確認する。

    2026-09-18の実地検証で、ブランド名を含めないクエリ（build_query_candidatesの1番目）が
    全く別ブランドの商品にマッチする事故が実際に発生した(例: セザンヌで検索したはずが
    「Love Liner ラブライナー」がヒットした)。ブランド名がitemName等に一切含まれない結果は
    採用しない。"""
    if not brand:
        return True
    haystack = f"{item.get('itemName', '')} {item.get('catchcopy', '')} {item.get('shopName', '')}"
    return brand in haystack


def _search_once(query: str, brand: str, alt_label: str):
    """1クエリだけ試す。ブランド名が一致する最初の結果を返す（見つからなければNone）。"""
    params = {
        "format": "json",
        "keyword": query,
        "hits": 10,
        "applicationId": RAKUTEN_APP_ID,
        "accessKey": RAKUTEN_ACCESS_KEY,
        "affiliateId": RAKUTEN_AFFILIATE_ID,
    }
    try:
        response = requests.get(SEARCH_URL, params=params, timeout=15)
    except requests.RequestException as e:
        raise RakutenAPIUnavailable(str(e))

    if response.status_code >= 500 or response.status_code in (401, 403, 429):
        raise RakutenAPIUnavailable(f"HTTP {response.status_code}: {response.text[:200]}")
    if response.status_code != 200:
        # 400 wrong_parameter 等はこのクエリ候補が悪いだけなので、次の候補に進む
        print(f"  [{alt_label}] クエリ不正: HTTP {response.status_code} / {response.text[:150]}")
        return None

    data = response.json()
    items = data.get("Items")
    if not items:
        return None

    matched_item = None
    for wrapped in items:
        item = wrapped["Item"]
        if _brand_matches(brand, item):
            matched_item = item
            break
    if matched_item is None:
        print(f"  [{alt_label}] {len(items)}件ヒットしたがブランド名一致なし（誤ブランド回避のためスキップ）")
        return None

    medium_images = matched_item.get("mediumImageUrls")
    affiliate_link = matched_item.get("affiliateUrl")
    if not medium_images or not affiliate_link:
        return None

    base_image_url = medium_images[0]["imageUrl"]
    image_url_240 = base_image_url.replace("?_ex=128x128", "?_ex=240x240")
    return {
        "affiliate_link": affiliate_link,
        "image_url_240": image_url_240,
        "price": matched_item.get("itemPrice"),
    }


def get_rakuten_item_info(brand: str, name: str):
    """(image_html, affiliate_link, price) を返す。見つからなければ (None, None, None)。
    API自体が一時的に使えない場合は RakutenAPIUnavailable を送出する。

    build_query_candidates() で作った候補を順番に試し、最初にヒットしたものを採用する。"""
    candidates = build_query_candidates(brand, name)
    product_name = f"{brand} {name}"

    for i, query in enumerate(candidates):
        if i > 0:
            time.sleep(1.2)  # 楽天APIのレート制限(概ね1req/sec)への配慮
        result = _search_once(query, brand, f"候補{i+1}/{len(candidates)}: {query}")
        if result:
            image_html = (
                f'<a href="{result["affiliate_link"]}" target="_blank" rel="nofollow sponsored noopener">'
                f'<img src="{result["image_url_240"]}" border="0" style="margin:2px" '
                f'alt="{product_name}" title="{product_name}"></a>'
            )
            return image_html, result["affiliate_link"], result["price"]

    return None, None, None


def is_link_alive(url: str) -> bool:
    """既存のアフィリエイトリンクがまだ商品ページに到達できるか確認する。

    アフィリエイトのリダイレクト自体は商品が無くなっていても200を返すことがあるため完璧ではないが、
    404・接続エラー・明らかなエラーページへの到達は検知できる。
    """
    try:
        resp = requests.get(url, timeout=25, allow_redirects=True)
        if resp.status_code >= 400:
            return False
        # 楽天の「ページが見つかりません」的な文言を軽くチェック
        if "ページが見つかりません" in resp.text or "商品はございません" in resp.text:
            return False
        return True
    except requests.RequestException:
        return False
