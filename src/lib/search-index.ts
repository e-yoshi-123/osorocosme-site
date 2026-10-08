import brandSearchAliases from "../data/brand-search-aliases.json";
import {
  getVisibleVideos,
  getBrandsWithVideos,
  getBrandReading,
  getInfluencerRanking,
  getCosmeticListEntry,
  canonicalBrandId,
  isPrMention,
  getAliasRedirects,
  getProductRedirects,
  cosmeticSlug,
  productImageSrc,
  toNumber,
} from "./data";

/** カテゴリ名に含まれない呼び方（「クレド リップ」で口紅が引けるように） */
const CATEGORY_WORDS: Record<string, string> = {
  口紅: "リップ ルージュ リップスティック",
  リップグロス: "リップ グロス",
  "リップケア・リップクリーム": "リップ",
  化粧下地: "下地 プライマー ベース",
  "日焼け止め・UVケア(顔用)": "UV 日焼け止め",
  パウダーアイシャドウ: "シャドウ シャドー",
  "ジェル・クリームアイシャドウ": "シャドウ シャドー",
  パウダーチーク: "チーク",
  プレストパウダー: "パウダー フェイスパウダー おしろい",
  ルースパウダー: "パウダー フェイスパウダー おしろい",
  "メイクアップキット・パレット": "パレット",
  "香水・フレグランス(レディース・ウィメンズ)": "香水 フレグランス",
  "シートマスク・パック": "パック マスク",
};

/** サイト内検索の索引（search-result.astro が読む。検索欄の候補 search-suggest.json はこの一部）。容量を抑えるため、項目は配列で持ち、相互の参照は番号にする。
 * - b（ブランド）: [brand_id, 名前, 検索用の別名（読み・英字表記・通称を空白区切り）, 動画数, コスメ数]
 * - i（インフルエンサー）: [channel_id, 名前, アイコン, 登録者数, 動画数]
 * - c（コスメ）: [slug, ブランド名, bの番号（ページの無いブランドは-1）, 商品名, 画像, カテゴリ（＋通称）, 動画数]
 * - v（動画）: [key, 題名, iの番号, 概要欄, サムネイル, 公開日, cの番号の配列] */
export type SearchIndex = { b: (string | number)[][]; i: (string | number)[][]; c: (string | number)[][]; v: (string | number | number[])[][] };

let cache: SearchIndex | undefined;
export function buildSearchIndex(): SearchIndex {
  if (cache) return cache;
  const aliases = brandSearchAliases as unknown as Record<string, string[] | string>;

  const brands = getBrandsWithVideos().sort((a, b) => b.videoCount - a.videoCount);
  const brandIdx = new Map(brands.map((b, n) => [b.brand_id, n]));
  const b = brands.map((br) => {
    const extra = Array.isArray(aliases[br.brand_id]) ? (aliases[br.brand_id] as string[]) : [];
    const kw = [getBrandReading(br.brand_id), ...extra].filter(Boolean).join(" ");
    return [br.brand_id, br.name, kw, br.videoCount, br.cosmeticCount];
  });

  const influencers = getInfluencerRanking();
  const infIdx = new Map(influencers.map((inf, n) => [inf.channel_id, n]));
  const i = influencers.map((inf) => [inf.channel_id, inf.channel_title, inf.channel_icon || "", toNumber(inf.subscriber_count), inf.videoCount]);

  const videos = getVisibleVideos();
  const cosmetics = new Map<string, { row: (string | number)[]; videos: Set<string> }>();
  for (const v of videos) {
    for (const c of v.cosmetics || []) {
      if (!c.brand_id || !c.name_id || !c.name) continue;
      const key = `${c.brand_id}_${c.name_id}`;
      if (!cosmetics.has(key)) {
        const entry = getCosmeticListEntry(c.brand_id, c.name_id);
        const bid = canonicalBrandId(c.brand_id);
        const category = entry?.category || c.related_tags?.[0] || "";
        cosmetics.set(key, {
          row: [cosmeticSlug(c.brand_id, c.name_id), entry?.brand || c.brand, brandIdx.get(bid) ?? -1, entry?.name || c.name, productImageSrc(entry, c.rakuten_image_link), [category, CATEGORY_WORDS[category]].filter(Boolean).join(" ")],
          videos: new Set(),
        });
      }
      cosmetics.get(key)!.videos.add(v.key);
    }
  }
  const cosmeticList = [...cosmetics.entries()].sort((x, y) => y[1].videos.size - x[1].videos.size);
  const cosIdx = new Map(cosmeticList.map(([key], n) => [key, n]));
  const c = cosmeticList.map(([, e]) => [...e.row, e.videos.size]);

  const v = videos.map((vid) => [
    vid.key,
    vid.title,
    infIdx.get(vid.channel_id) ?? -1,
    vid.description || "",
    vid.thumbnail,
    vid.published_at,
    [...new Set((vid.cosmetics || []).map((x) => cosIdx.get(`${x.brand_id}_${x.name_id}`)).filter((n) => n !== undefined))],
  ]);

  cache = { b, i, c, v };
  return cache;
}

/** マイコスメ（/my-cosme/）のおすすめの元データ（recommend.json。5-3）。おすすめはブラウザで計算する（scripts/my-cosme-page.ts）。
 * 「自分のコスメを使っている人が、ほかに使っているコスメ」を出すため、チャンネルごとに紹介したコスメの番号を持つ（PR・提供の紹介は数えない。197章）。
 * - b（ブランド）: [名前, 検索用の別名]（索引の b と同じ順）
 * - c（コスメ）: [slug, ブランド名, bの番号, 商品名, 画像, カテゴリ, 動画数]（索引の c と同じ順。容量を抑えるため、ブランド名は b の名前と同じなら空にし、
 *   画像は楽天の決まった前後を省く：「~」で始まるもの）
 * - ch（チャンネル）: [channel_id, 名前, アイコン, cの番号の配列]
 * - r（転送）: { 旧slug: 新slug }（保存した商品が、表記揺れの統合などで別の商品に寄せられたとき） */
export const RAKUTEN_IMG_HEAD = "https://thumbnail.image.rakuten.co.jp/@0_mall/";
export const RAKUTEN_IMG_TAIL = "?_ex=240x240";
export function buildRecommendIndex() {
  const idx = buildSearchIndex();
  const cosIdx = new Map(idx.c.map((row, n) => [String(row[0]), n]));
  const shortImg = (src: string) =>
    src.startsWith(RAKUTEN_IMG_HEAD) && src.endsWith(RAKUTEN_IMG_TAIL) ? `~${src.slice(RAKUTEN_IMG_HEAD.length, -RAKUTEN_IMG_TAIL.length)}` : src;
  const c = idx.c.map((row) => {
    const slug = String(row[0]);
    const [brand_id, name_id] = [slug.slice(0, slug.indexOf("-name-")), slug.slice(slug.indexOf("-name-") + 1)];
    const entry = getCosmeticListEntry(brand_id, name_id);
    const brandName = Number(row[2]) >= 0 && idx.b[Number(row[2])][1] === row[1] ? "" : row[1];
    return [slug, brandName, row[2], row[3], shortImg(String(row[4])), entry?.category || String(row[5]).split(" ")[0] || "", row[6]];
  });
  const byChannel = new Map<string, { title: string; icon: string; items: Set<number> }>();
  for (const v of getVisibleVideos()) {
    for (const x of v.cosmetics || []) {
      if (!x.brand_id || !x.name_id || isPrMention(v.key, x.brand_id, x.name_id)) continue;
      const n = cosIdx.get(cosmeticSlug(x.brand_id, x.name_id));
      if (n === undefined) continue;
      let ch = byChannel.get(v.channel_id);
      if (!ch) byChannel.set(v.channel_id, (ch = { title: v.channel_title, icon: v.channel_icon || "", items: new Set() }));
      ch.items.add(n);
    }
  }
  const ch = [...byChannel.entries()].map(([id, x]) => [id, x.title, x.icon, [...x.items].sort((a, b) => a - b)]);
  const r: Record<string, string> = {};
  for (const x of [...getAliasRedirects().products, ...getProductRedirects()]) r[x.from] = x.to;
  return { b: idx.b.map((x) => [x[1], x[2]]), c, ch, r };
}
