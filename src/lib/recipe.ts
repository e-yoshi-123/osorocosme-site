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
  RANKING_CATEGORY_GROUPS,
  type VideoEntry,
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

/** 顔のイラスト（FaceArt）の顔の枠（400×520）の上で、各部位を指す点。画像（750×750）の座標から FACE_IMAGE の位置を引いたもの。
 * 前髪のある髪型ではおでこが隠れるので、ベースは左の頬を指す（右の頬はチーク） */
export const FACE_ANCHORS: Record<PartKey, { x: number; y: number }> = {
  base: { x: 140, y: 282 },
  brow: { x: 143, y: 190 },
  eye: { x: 137, y: 229 },
  cheek: { x: 267, y: 262 },
  lip: { x: 219, y: 315 },
};
/** 顔の画像の置き方（顔の枠の原点からの位置と大きさ）。画像は正方形で、元の 750×750 の座標に合わせて置く */
export const FACE_IMAGE = { x: -175, y: -60, w: 750, h: 750 };
/** 顔の色の版（public/recipe/faces/face-<版>.webp。非公開リポジトリの tools/recipe_face/make_faces.py で作る）。
 * 6つの版（元の色・ローズ・モーヴ・ミルクティー・ブラウン・線画）を見比べて、ミルクティーに決めた（ユーザー判断、283章） */
export const FACE_DEFAULT = "milktea";

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

/** 動画の1品を、レシピ・動画ページの1行にする */
function toItem(v: VideoEntry, c: NonNullable<VideoEntry["cosmetics"]>[number], tag: string | undefined, part: string): RecipeItem {
  const slug = cosmeticSlug(c.brand_id, c.name_id);
  const entry = getCosmeticListEntry(c.brand_id, c.name_id);
  const offer = productOffer(entry, c.rakuten_image_link);
  const sec = sceneSeconds(c.time_in_video);
  return {
    brand_id: c.brand_id, brand: c.brand, name_id: c.name_id, name: c.name, slug, tag: tag || "", part: part as PartKey,
    time: sec !== undefined ? c.time_in_video : undefined, sec,
    img: offer.imageSrc, price: offer.imageSrc ? offer.price : undefined, fromYahoo: offer.source === "yahoo",
    rakutenLink: offer.rakutenLink, yahooLink: entry?.yahoo_text_link || undefined,
    pr: isPrMention(v.key, c.brand_id, c.name_id),
  };
}

/** 動画ページの「紹介されたコスメ」のまとまり（284章）。メイクはレシピと同じ部位（PARTS）、ほかはランキングの大分類で分ける。
 * 並びは使う順（スキンケア→ベース→眉→アイ→チーク・陰影→リップ→ヘア→ボディ→道具→その他） */
export const VIDEO_GROUPS: { key: string; label: string; en: string; color: string }[] = [
  { key: "skin", label: "スキンケア", en: "Skincare", color: "#7f9e8c" },
  ...PARTS.map(({ key, label, en, color }) => ({ key, label, en, color })),
  { key: "hair", label: "ヘアケア", en: "Hair", color: "#a3845c" },
  { key: "body", label: "ボディケア", en: "Body", color: "#8d86b5" },
  { key: "tool", label: "メイク道具・小物", en: "Tools", color: "#8a96a3" },
  { key: "other", label: "その他", en: "Others", color: "#a39a94" },
];
const RANK_GROUP_TO_VIDEO: Record<string, string> = {
  "ベースメイク": "base", "アイブロウ": "brow", "アイメイク": "eye", "チーク・陰影": "cheek", "リップ": "lip",
  "メイク小物・その他": "tool", "スキンケア": "skin", "ヘアケア": "hair", "ボディケア": "body",
};
const TAG_TO_VIDEO: Record<string, string> = Object.fromEntries(
  RANKING_CATEGORY_GROUPS.flatMap((g) => g.tags.map((t) => [t, RANK_GROUP_TO_VIDEO[g.group] || "other"])),
);

export interface VideoCosmeticGroups {
  groups: { key: string; label: string; en: string; color: string; items: RecipeItem[] }[];
  durationSec: number;
}
/** 動画の紹介コスメを VIDEO_GROUPS に振り分ける。まとまりの中は動画で使った順（時刻の無い品は後ろ、元の並び） */
export function getVideoCosmeticGroups(v: VideoEntry): VideoCosmeticGroups {
  const buckets = new Map<string, RecipeItem[]>(VIDEO_GROUPS.map((g) => [g.key, []]));
  const seen = new Set<string>();
  for (const c of v.cosmetics || []) {
    if (!c.brand_id || !c.name_id || !c.name || !c.brand) continue;
    const slug = cosmeticSlug(c.brand_id, c.name_id);
    if (seen.has(slug)) continue;
    seen.add(slug);
    const tag = cosmeticCategory(c);
    const pi = tag !== undefined ? PART_OF[tag] : undefined;
    const key = pi !== undefined ? PARTS[pi].key : (tag && TAG_TO_VIDEO[tag]) || "other";
    buckets.get(key)!.push(toItem(v, c, tag, key));
  }
  const groups = VIDEO_GROUPS.map((g) => ({ ...g, items: buckets.get(g.key)! })).filter((g) => g.items.length);
  for (const g of groups) g.items.sort((a, b) => (a.sec ?? Infinity) - (b.sec ?? Infinity));
  return { groups, durationSec: isoSeconds(v.duration) };
}

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
      steps[pi].push(toItem(v, c, tag, PARTS[pi].key));
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
