"""@cosme(cosme.net)からブランド・商品一覧を取得するスクレイパー。
旧 edit/attocosme-scraping.py のロジックを踏襲しつつ、以下を変更している:
  - 上位500ブランドへの絞り込みは廃止（全ブランド対象、コストはLLM側の設計で吸収する）
  - 完全洗い替えではなく、既存カタログへの「差分追加」専用（既存のbrand_id/name_idは一切変更しない）
"""

import re
import time
import requests
from bs4 import BeautifulSoup

SITEMAP_URL = "https://www.cosme.net/sitemap-brand-products.xml"
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


def _get_review_count(review_ul) -> int:
    if review_ul:
        m = re.search(r"クチコミ(\d+)件", review_ul.text)
        if m:
            return int(m.group(1))
    return 0


def _get_rating(review_ul):
    """5点満点の評価点(例: 5.4)。無ければNone。"""
    if not review_ul:
        return None
    tag = review_ul.select_one("li.top strong")
    if tag:
        try:
            return float(tag.text.strip())
        except ValueError:
            return None
    return None


def _get_ranking_pt(review_ul):
    """@cosmeランキングポイント(例: "132.1pt")。無ければNone。"""
    if not review_ul:
        return None
    tag = review_ul.select_one("li.rankingPt span")
    return tag.text.strip() if tag else None


def _get_release_date(product_text_div):
    """発売日を取得する。無ければNone。価格は楽天APIから別途取得するためここでは扱わない。"""
    if not product_text_div:
        return None
    for li in product_text_div.select("ul.brand-renewal-price-info li"):
        text = li.get_text(strip=True)
        if text.startswith("発売日"):
            return text.split("：", 1)[-1].strip()
    return None


def get_products_for_brand(cosme_brand_id: int) -> list[dict]:
    """[{name, category, review_count, rating, ranking_pt, release_date,
    image_url}, ...] を返す(カテゴリ除外フィルタ適用済み)。
    ※商品ページURLはアフィリエイト提携をしていないため保持しない(2026-09-18時点)。
    すべて商品一覧ページ内の情報のみで完結させ、商品ごとの追加リクエストは発生させない。"""
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

            review_ul = block.select_one("ul.review")
            product_text = block.select_one("div.productText")
            release_date = _get_release_date(product_text)

            image_url = None
            picture = block.find_previous_sibling("div", class_="productPicture") or (
                block.parent.select_one("div.productPicture") if block.parent else None
            )
            if picture:
                img_tag = picture.select_one("img")
                if img_tag and img_tag.get("src"):
                    image_url = img_tag["src"]

            products.append(
                {
                    "name": name,
                    "category": category,
                    "review_count": _get_review_count(review_ul),
                    "rating": _get_rating(review_ul),
                    "ranking_pt": _get_ranking_pt(review_ul),
                    "release_date": release_date,
                    "image_url": image_url,
                }
            )

        if stop:
            break
        page += 1
        time.sleep(REQUEST_DELAY)

    return products


def scrape_one_brand(sitemap_url: str):
    """1ブランド分を取得する。(brand_name, products) を返す。取得できなければ (None, [])。"""
    cosme_brand_id = extract_cosme_brand_id(sitemap_url)
    if cosme_brand_id is None:
        return None, []
    brand_name = get_brand_name(cosme_brand_id)
    time.sleep(REQUEST_DELAY)
    if not brand_name:
        return None, []
    products = get_products_for_brand(cosme_brand_id)
    return brand_name, products
