import type { APIRoute } from "astro";
import brandSearchAliases from "../data/brand-search-aliases.json";
import {
  getVisibleVideos,
  getBrandsWithVideos,
  getBrandReading,
  getInfluencerRanking,
  getCosmeticListEntry,
  canonicalBrandId,
  cosmeticSlug,
  productImageSrc,
  toNumber,
} from "../lib/data";

export const prerender = true;

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

/** サイト内検索の索引（search-result.astro が読む）。容量を抑えるため、項目は配列で持ち、相互の参照は番号にする。
 * - b（ブランド）: [brand_id, 名前, 検索用の別名（読み・英字表記・通称を空白区切り）, 動画数, コスメ数]
 * - i（インフルエンサー）: [channel_id, 名前, アイコン, 登録者数, 動画数]
 * - c（コスメ）: [slug, ブランド名, bの番号（ページの無いブランドは-1）, 商品名, 画像, カテゴリ（＋通称）, 動画数]
 * - v（動画）: [key, 題名, iの番号, 概要欄, サムネイル, 公開日, cの番号の配列] */
export const GET: APIRoute = () => {
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

  return new Response(JSON.stringify({ b, i, c, v }), {
    headers: { "Content-Type": "application/json" },
  });
};
