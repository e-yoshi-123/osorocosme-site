"""@cosme(cosme.net)からブランド・商品一覧を取得するスクレイパー。
旧 edit/attocosme-scraping.py のロジックを踏襲しつつ、以下を変更している:
  - 上位500ブランド(レビュー数ベース)への絞り込みは廃止し、代わりにカテゴリ別ランキング
    (cosme.net/ranking/category/items 配下の各カテゴリ上位)に登場するブランドに絞り込む
    （@cosmeには全ブランドを人気順に並べた一覧ページが存在しないため。詳細は
    fetch_item_category_ids / fetch_popular_brand_ids 参照）
  - 完全洗い替えではなく、既存カタログへの「差分追加」専用（既存のbrand_id/name_idは一切変更しない）
"""

import re
import time
import requests
from bs4 import BeautifulSoup

SITEMAP_URL = "https://www.cosme.net/sitemap-brand-products.xml"
RANKING_CATEGORY_INDEX_URL = "https://www.cosme.net/ranking/category/items"
RANKING_PAGE_URL = "https://www.cosme.net/categories/item/{category_id}/ranking/"
REQUEST_DELAY = 1.0  # サイトへの配慮

# 旧 edit/brand_reviewcount_filter.py・csv_edit.py と同一の除外カテゴリ
SKIP_CATEGORIES = {
    "ドリンク", "健康サプリメント", "書籍", "歯ブラシ・デンタルフロス", "歯磨き粉",
    "雑誌", "食品", "マッサージ料", "美容家電", "あぶらとり紙", "化粧ポーチ",
    "白髪染め・ヘアカラー・ブリーチ", "DVD・ソフト", "その他オーラルケア",
    "その他キットセット", "その他グッズ", "その他スキンケア", "その他スキンケアグッズ",
    "その他ヘアスタイリング", "その他ボディケア", "デオドラント・制汗剤", "入浴剤",
    "ネイル用品", "トライアル・トラベルキット", "ネイルケア", "ネイルトップコート・ベースコート",
    "除光液", "頭皮ケア", "香水・フレグランス(レディース・ウィメンズ)", "美肌サプリメント",
    "レッグ・フットケア", "マニキュア", "スキンケアキット", "",
    "シャンプー・コンディショナー", "アウトバストリートメント", "香水・フレグランス(その他)",
    "香水・フレグランス(メンズ)", "脱毛・除毛", "ボディクリーム・オイル", "ボディケア美容家電",
    "ボディシェイプサプリメント", "ボディスクラブ", "ボディソープ", "ボディマッサージ",
    "ボディローション・ミルク", "ボディ・バスグッズ", "ボディ石鹸", "洗い流すパック・マスク",
    "洗顔パウダー", "洗顔フォーム", "洗顔石鹸", "ヘアケアグッズ", "ヘアケア美容家電",
    "ヘアジェル", "ヘアスプレー・ヘアミスト", "ヘアパック・トリートメント", "ヘアムース",
    "プレスタイリング・寝ぐせ直し", "パーマ液", "ネック・デコルテケア",
    "ヘアワックス・クリーム", "日焼け止め・UVケア(ボディ用)", "その他メイクグッズ",
    "その他洗顔料", "つけ爪・ネイルチップ", "バストアップ・ヒップケア", "その他",
}


def fetch_sitemap_urls() -> list[str]:
    res = requests.get(SITEMAP_URL, timeout=30)
    res.raise_for_status()
    # 巨大な1行XMLなのでETreeより素直に正規表現で十分
    return re.findall(r"<loc>(.*?)</loc>", res.text)


def extract_cosme_brand_id(url: str):
    m = re.search(r"/brand/brand_id/(\d+)/products", url)
    return int(m.group(1)) if m else None


def fetch_item_category_ids() -> list[int]:
    """アイテムカテゴリ別ランキングのカテゴリID一覧を取得する。"""
    res = requests.get(RANKING_CATEGORY_INDEX_URL, timeout=30)
    res.raise_for_status()
    ids = {int(m) for m in re.findall(r"/categories/item/(\d+)/ranking/", res.text)}
    return sorted(ids)


RANKING_PAGES_PER_CATEGORY = 3  # 1ページ10件 x 3ページ = 上位30件


def fetch_popular_brand_ids(category_ids: list[int]) -> set[int]:
    """各アイテムカテゴリのランキング上位30件（10件x3ページ、?page=2,3で確認済み）に
    登場するブランドの cosme_brand_id 集合を返す。@cosme全体を人気順に並べた一覧が
    存在しないため、カテゴリ別ランキングの上位商品から逆引きする方式で
    「人気ブランド」を近似する。"""
    brand_ids: set[int] = set()
    for category_id in category_ids:
        base_url = RANKING_PAGE_URL.format(category_id=category_id)
        for page in range(1, RANKING_PAGES_PER_CATEGORY + 1):
            url = base_url if page == 1 else f"{base_url}?page={page}"
            try:
                res = requests.get(url, timeout=15)
            except requests.RequestException:
                continue
            if res.status_code != 200:
                continue
            brand_ids.update(int(m) for m in re.findall(r"/brands/(\d+)/", res.text))
            time.sleep(REQUEST_DELAY)
    return brand_ids


def get_brand_name(cosme_brand_id: int):
    url = f"https://www.cosme.net/brands/{cosme_brand_id}/"
    try:
        res = requests.get(url, allow_redirects=True, timeout=15)
        if res.status_code != 200:
            return None
        redirected = re.search(r"/brands/(\d+)/", res.url)
        if redirected and int(redirected.group(1)) != cosme_brand_id:
            return None
        soup = BeautifulSoup(res.text, "html.parser")
        tag = soup.select_one("h2")
        return tag.text.strip() if tag else None
    except requests.RequestException:
        return None


def get_products_for_brand(cosme_brand_id: int, known_names: "set[str] | None" = None) -> list[dict]:
    """[{name, category}, ...] を返す(カテゴリ除外フィルタ適用済み)。
    ※商品ページURLはアフィリエイト提携をしていないため保持しない(2026-09-18時点)。
    口コミ件数・評価点・ランキングポイント・発売日・商品画像も一覧ページ内に存在するが、
    元々の取得項目(brand/name/category)以外は追加しない方針に戻したため取得しない。
    すべて商品一覧ページ内の情報のみで完結させ、商品ごとの追加リクエストは発生させない。

    known_names: このブランドについて既にカタログ側で把握済みの商品名の集合。
    渡された場合、あるページの商品が1件も新規で無かった時点でそれ以降のページ取得を
    打ち切る(再クロール時の節約用。新規追加分は掲載順の都合上、先頭寄りのページに
    出る前提のヒューリスティックであり、完全性より速度を優先する)。"""
    products = []
    page = 1
    while True:
        url = f"https://www.cosme.net/brands/{cosme_brand_id}/product/?page={page}"
        try:
            res = requests.get(url, timeout=15)
        except requests.RequestException:
            break
        if res.status_code != 200:
            break

        soup = BeautifulSoup(res.text, "html.parser")
        blocks = soup.select("div.productName")
        if not blocks:
            break

        stop = False
        page_has_new = known_names is None
        for block in blocks:
            if "(生産終了)" in block.text:
                stop = True
                break
            a_tag = block.select_one("h4 > a")
            if not a_tag:
                continue
            name = a_tag.text.strip()
            product_url = a_tag.get("href", "").strip()
            if not product_url.startswith("https://www.cosme.net/products/"):
                continue
            category_tag = block.select_one("ul.category li a")
            category = category_tag.text.strip() if category_tag else ""
            if category in SKIP_CATEGORIES:
                continue

            if known_names is not None and name not in known_names:
                page_has_new = True

            products.append({"name": name, "category": category})

        if stop or not page_has_new:
            break
        page += 1
        time.sleep(REQUEST_DELAY)

    return products


def scrape_one_brand(sitemap_url: str, known_names_for_brand=None):
    """1ブランド分を取得する。(brand_name, products) を返す。取得できなければ (None, [])。

    known_names_for_brand: brand_name(str) -> 既知の商品名の集合、を返すコールバック(省略可)。
    渡した場合、get_products_for_brand の早期打ち切りに使われる。"""
    cosme_brand_id = extract_cosme_brand_id(sitemap_url)
    if cosme_brand_id is None:
        return None, []
    brand_name = get_brand_name(cosme_brand_id)
    time.sleep(REQUEST_DELAY)
    if not brand_name:
        return None, []
    known_names = known_names_for_brand(brand_name) if known_names_for_brand else None
    products = get_products_for_brand(cosme_brand_id, known_names=known_names)
    return brand_name, products
