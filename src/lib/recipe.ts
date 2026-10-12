// メイクレシピ（試作、283章）。動画で使われた商品を、顔の部位ごとの手順に並べ直して「レシピ」にする。
// 出典は字幕から抽出した紹介コスメと、字幕の一致で決めた場面の時刻（266章）だけ。レシピ画像の転載はしない（決定事項）。
import {
  getVisibleVideos,
  getPrInfo,
  isPrMention,
  cosmeticCategory,
  getCosmeticListEntry,
  productOffer,
  cosmeticSlug,
  sortByPublishedDesc,
  REPEAT_EXCLUDE_TITLE,
} from "./data";

export type PartKey = "base" | "brow" | "eye" | "cheek" | "lip";

/** 手順（顔の部位）。カテゴリ（補正後の related_tags の先頭）で振り分ける。ここに無いカテゴリ（スキンケア・ヘア・小物など）は入れない。
 * color は部位の印の色（ベージュ→ブラウン→モーヴ→ピンク→ローズ。図・時間の帯・手順の番号で同じ色を使う） */
export const PARTS: { key: PartKey; label: string; en: string; color: string; tags: string[] }[] = [
  {
    key: "base", label: "ベース", en: "Base", color: "#c99a82",
    tags: ["化粧下地", "日焼け止め・UVケア(顔用)", "リキッドファンデーション", "クリーム・ジェルファンデーション", "パウダーファンデーション", "ファンデーション", "その他ファンデーション", "クッションファンデ", "BB・CCクリーム", "コンシーラー", "プレストパウダー", "ルースパウダー"],
  },
  { key: "brow", label: "眉", en: "Brow", color: "#7a5446", tags: ["アイブロウペンシル", "パウダーアイブロウ", "眉マスカラ", "その他アイブロウ", "アイブロウ"] },
  {
    key: "eye", label: "アイ", en: "Eye", color: "#9b5579",
    tags: ["アイシャドウベース", "パウダーアイシャドウ", "ジェル・クリームアイシャドウ", "アイシャドウ", "アイシャドウパレット", "リキッドアイライナー", "ジェルアイライナー", "ペンシルアイライナー", "その他アイライナー", "マスカラ下地・トップコート", "マスカラ", "つけまつげ"],
  },
  { key: "cheek", label: "チーク・陰影", en: "Cheek", color: "#e47f9d", tags: ["パウダーチーク", "ジェル・クリームチーク", "ハイライト", "シェーディング"] },
  { key: "lip", label: "リップ", en: "Lip", color: "#e60076", tags: ["リップライナー", "口紅", "リップグロス", "リップケア・リップクリーム"] },
];
const PART_OF: Record<string, number> = Object.fromEntries(PARTS.flatMap((s, i) => s.tags.map((t) => [t, i])));

/** 顔の線画（FaceArt、viewBox 400×520）の上で、各部位を指す点 */
export const FACE_ANCHORS: Record<PartKey, { x: number; y: number }> = {
  base: { x: 240, y: 166 },
  brow: { x: 152, y: 211 },
  eye: { x: 150, y: 245 },
  cheek: { x: 254, y: 300 },
  lip: { x: 214, y: 349 },
};

/** 動画タイトルに明記された語で付けるテイスト（特集と同じく、タイトルにある語だけを使う。68章）。phrase はレシピの名前に使う */
export const TASTES: { key: string; label: string; phrase: string; re: RegExp }[] = [
  { key: "daily", label: "毎日メイク", phrase: "毎日メイク", re: /毎日メイク|デイリー|いつものメイク|普段メイク|日常メイク/ },
  { key: "akanuke", label: "垢抜け", phrase: "垢抜けメイク", re: /垢抜け|あか抜け/ },
  { key: "otona", label: "大人メイク", phrase: "大人メイク", re: /大人|30代|40代|50代|アラサー|アラフォー|アラフィフ/ },
  { key: "petit", label: "プチプラ", phrase: "プチプラメイク", re: /プチプラ|ドラコス|ドラッグストア|ドンキ|ダイソー|セザンヌ縛り|ちふれ縛り/ },
  { key: "depa", label: "デパコス", phrase: "デパコスメイク", re: /デパコス/ },
  { key: "korea", label: "韓国風", phrase: "韓国風メイク", re: /韓国|オルチャン|K-?POP|ケーポップ/i },
  { key: "tsuya", label: "ツヤ肌", phrase: "ツヤ肌メイク", re: /ツヤ|艶|水光/ },
  { key: "clear", label: "透明感", phrase: "透明感メイク", re: /透明感/ },
  { key: "natural", label: "ナチュラル", phrase: "ナチュラルメイク", re: /ナチュラル|すっぴん風|ナチュ|薄メイク|薄づき/ },
  { key: "date", label: "デート", phrase: "デートメイク", re: /デート/ },
  { key: "keep", label: "崩れない", phrase: "崩れないメイク", re: /崩れない|崩れにくい|マスク|汗/ },
  { key: "pink", label: "ピンク", phrase: "ピンクメイク", re: /ピンク/ },
  { key: "yb", label: "イエベ", phrase: "イエベメイク", re: /イエベ/ },
  { key: "bb", label: "ブルベ", phrase: "ブルベメイク", re: /ブルベ/ },
  { key: "spring", label: "春", phrase: "春メイク", re: /(?<!イエベ|ブルベ)春(?!夏|秋|冬)|spring/i },
  { key: "summer", label: "夏", phrase: "夏メイク", re: /(?<!イエベ|ブルベ)夏|summer/i },
  { key: "autumn", label: "秋", phrase: "秋メイク", re: /(?<!イエベ|ブルベ)秋|autumn|fall/i },
  { key: "winter", label: "冬", phrase: "冬メイク", re: /(?<!イエベ|ブルベ)冬|winter/i },
];

export interface RecipeItem {
  brand_id: string;
  brand: string;
  name_id: string;
  name: string;
  slug: string;
  tag: string;
  part: PartKey;
  time?: string;
  sec?: number;
  img: string;
  price?: number;
  fromYahoo: boolean;
  rakutenLink?: string;
  yahooLink?: string;
  pr: boolean;
}
export interface Recipe {
  key: string;
  /** 投稿の古い順の通し番号（No.001〜）。データが増えると変わるので、URLには使わない */
  no: number;
  video: { video_id: string; title: string; channel_title: string; channel_id: string; channel_icon?: string; published_at: string; thumbnail: string };
  /** PARTS の順。部位ごとの中は動画で使った順（時刻の無い品は後ろ） */
  steps: RecipeItem[][];
  tastes: string[];
  headline: string;
  itemCount: number;
  stepCount: number;
  /** 価格の分かる品の合計（参考価格）と、その品数 */
  total: number;
  pricedCount: number;
  /** 動画の長さ（秒）。分からなければ 0 */
  durationSec: number;
}

// 「m:ss」「h:mm:ss」を秒に（動画ページと同じ）
export const sceneSeconds = (t?: string) => {
  if (!t || !/^\d+(:\d{1,2}){1,2}$/.test(t)) return undefined;
  return t.split(":").reduce((a, x) => a * 60 + Number(x), 0);
};
const isoSeconds = (d?: string) => {
  const m = d?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  return m ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0) : 0;
};

/** レシピにする条件：ベース・アイ・リップがそろい、場面の時刻が付いた商品が3品以上。
 * 新作・購入品・比較などの紹介が目的の動画（リピートと同じ語＋全角の「７選」など）と、動画全体がPR・提供のものは除く */
export const RECIPE_MIN_TIMED = 3;
const EXCLUDE_EXTRA = /[０-９]+選|まとめ|紹介/;

let _recipes: Recipe[] | null = null;
export function getRecipes(): Recipe[] {
  if (_recipes) return _recipes;
  const list: Omit<Recipe, "no">[] = [];
  for (const v of sortByPublishedDesc(getVisibleVideos())) {
    const title = v.title || "";
    if (REPEAT_EXCLUDE_TITLE.test(title) || EXCLUDE_EXTRA.test(title) || getPrInfo(v.key)?.whole) continue;
    const seen = new Set<string>();
    const steps: RecipeItem[][] = PARTS.map(() => []);
    for (const c of v.cosmetics || []) {
      if (!c.brand_id || !c.name_id || !c.name) continue;
      const tag = cosmeticCategory(c);
      const pi = tag !== undefined ? PART_OF[tag] : undefined;
      if (pi === undefined) continue;
      const slug = cosmeticSlug(c.brand_id, c.name_id);
      if (seen.has(slug)) continue;
      seen.add(slug);
      const entry = getCosmeticListEntry(c.brand_id, c.name_id);
      const offer = productOffer(entry, c.rakuten_image_link);
      const sec = sceneSeconds(c.time_in_video);
      steps[pi].push({
        brand_id: c.brand_id, brand: c.brand, name_id: c.name_id, name: c.name, slug, tag: tag!, part: PARTS[pi].key,
        time: sec !== undefined ? c.time_in_video : undefined, sec,
        img: offer.imageSrc, price: offer.imageSrc ? offer.price : undefined, fromYahoo: offer.source === "yahoo",
        rakutenLink: offer.rakutenLink, yahooLink: entry?.yahoo_text_link || undefined,
        pr: isPrMention(v.key, c.brand_id, c.name_id),
      });
    }
    for (const s of steps) s.sort((a, b) => (a.sec ?? Infinity) - (b.sec ?? Infinity));
    const flat = steps.flat();
    const timed = flat.filter((x) => x.sec !== undefined).length;
    if (!steps[0].length || !steps[2].length || !steps[4].length || timed < RECIPE_MIN_TIMED) continue;
    const tastes = TASTES.filter((t) => t.re.test(title)).map((t) => t.key);
    const phrase = TASTES.find((t) => t.key === tastes[0])?.phrase ?? "メイク";
    const priced = flat.filter((x) => x.price);
    list.push({
      key: v.key,
      video: { video_id: v.video_id, title, channel_title: v.channel_title, channel_id: v.channel_id, channel_icon: v.channel_icon, published_at: v.published_at, thumbnail: v.thumbnail },
      steps, tastes,
      headline: `${v.channel_title}の${phrase}`,
      itemCount: flat.length,
      stepCount: steps.filter((s) => s.length).length,
      total: priced.reduce((n, x) => n + (x.price || 0), 0),
      pricedCount: priced.length,
      durationSec: isoSeconds(v.duration),
    });
  }
  _recipes = list.map((r, i) => ({ ...r, no: list.length - i }));
  return _recipes;
}

export function getRecipe(key: string): Recipe | undefined {
  return getRecipes().find((r) => r.key === key);
}

/** テイストごとの件数（3件以上のものだけ。並びは TASTES の順） */
export function getRecipeTastes() {
  const rs = getRecipes();
  return TASTES.map((t) => ({ key: t.key, label: t.label, count: rs.filter((r) => r.tastes.includes(t.key)).length })).filter((t) => t.count >= 3);
}

export const recipeNo = (n: number) => `No.${String(n).padStart(3, "0")}`;
export const partOf = (k: PartKey) => PARTS.find((p) => p.key === k)!;
