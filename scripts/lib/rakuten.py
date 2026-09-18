"""楽天市場 商品検索API(IchibaItem/Search)のラッパー。旧codes/rakuten_link_get.pyのロジックを踏襲。"""

import os
import requests

RAKUTEN_APP_ID = os.environ.get("RAKUTEN_APP_ID")
RAKUTEN_AFFILIATE_ID = os.environ.get("RAKUTEN_AFFILIATE_ID")
SEARCH_URL = "https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706"


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


class RakutenAPIUnavailable(Exception):
    """楽天API自体が一時的に利用できない状態（メンテナンス・5xx・通信エラー等）。
    「該当商品が見つからなかった」とは区別し、rakuten_link_noneは立てずにリトライ対象として扱う。"""


def get_rakuten_item_info(product_name: str):
    """(image_html, affiliate_link, price) を返す。見つからなければ (None, None, None)。
    API自体が一時的に使えない場合は RakutenAPIUnavailable を送出する。"""
    query = simplify_product_name(product_name)
    params = {
        "format": "json",
        "keyword": query,
        "applicationId": RAKUTEN_APP_ID,
        "affiliateId": RAKUTEN_AFFILIATE_ID,
    }
    try:
        response = requests.get(SEARCH_URL, params=params, timeout=15)
    except requests.RequestException as e:
        raise RakutenAPIUnavailable(str(e))

    if response.status_code >= 500:
        raise RakutenAPIUnavailable(f"HTTP {response.status_code}: {response.text[:200]}")
    if response.status_code != 200:
        print(f"  楽天APIエラー: HTTP {response.status_code} / {response.text[:200]}")
        return None, None, None

    data = response.json()
    items = data.get("Items")
    if not items:
        return None, None, None

    item = items[0]["Item"]
    medium_images = item.get("mediumImageUrls")
    if not medium_images:
        return None, None, None

    base_image_url = medium_images[0]["imageUrl"]
    image_url_240 = base_image_url.replace("?_ex=128x128", "?_ex=240x240")
    affiliate_link = item.get("affiliateUrl")
    price = item.get("itemPrice")
    if not affiliate_link:
        return None, None, None

    image_html = (
        f'<a href="{affiliate_link}" target="_blank" rel="nofollow sponsored noopener">'
        f'<img src="{image_url_240}" border="0" style="margin:2px" alt="{product_name}" title="{product_name}"></a>'
    )
    return image_html, affiliate_link, price


def is_link_alive(url: str) -> bool:
    """既存のアフィリエイトリンクがまだ商品ページに到達できるか確認する。

    アフィリエイトのリダイレクト自体は商品が無くなっていても200を返すことがあるため完璧ではないが、
    404・接続エラー・明らかなエラーページへの到達は検知できる。
    """
    try:
        resp = requests.get(url, timeout=10, allow_redirects=True)
        if resp.status_code >= 400:
            return False
        # 楽天の「ページが見つかりません」的な文言を軽くチェック
        if "ページが見つかりません" in resp.text or "商品はございません" in resp.text:
            return False
        return True
    except requests.RequestException:
        return False
