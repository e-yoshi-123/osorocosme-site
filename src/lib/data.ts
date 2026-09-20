import videosData from "../data/videos.json";
import brandsData from "../data/brands-list.json";
import cosmeticsListData from "../data/cosmetics_list.json";

export interface Cosmetic {
  brand_id: string;
  brand: string;
  name_id: string;
  name: string;
  related_tags?: string[];
  skin_concern?: string;
  rakuten_image_link?: string;
  rakuten_text_link?: string;
  amazon_link?: string;
  now_price?: number;
  mentions?: string[];
}

export interface Video {
  video_id: string;
  title: string;
  description: string;
  thumbnail: string;
  url: string;
  published_at: string;
  channel_title: string;
  channel_id: string;
  channel_icon?: string;
  subscriber_count?: string | number;
  view_count?: string | number;
  check_status?: boolean | string;
  delete_flg?: boolean;
  processed?: boolean;
  transcript_url?: string;
  cosmetics?: Cosmetic[];
  tags?: string[];
  summary?: string;
}

export interface VideoEntry extends Video {
  key: string;
}

export interface CosmeticListEntry {
  brand: string;
  brand_id: string;
  name: string;
  name_id: string;
  category?: string;
  amazon_link?: string;
  rakuten_image_link?: string;
  rakuten_text_link?: string;
  now_price?: number;
  count?: number;
  rakuten_link_none?: boolean;
}

export interface Influencer {
  channel_id: string;
  channel_title: string;
  channel_icon?: string;
  subscriber_count?: string | number;
}

const videos = videosData as unknown as Record<string, Video>;
const brands = brandsData as unknown as Record<string, string>;
const cosmeticsList = cosmeticsListData as unknown as Record<string, CosmeticListEntry>;

/** 現行WordPress実装は check_status の判定がページごとに不統一（緩い/厳密が混在するバグ）。
 * ここでは常に厳密判定（boolean true のみ有効）に統一する。 */
export function isVisible(v: Video): boolean {
  return v.check_status === true && v.delete_flg !== true;
}

export function getAllVideoEntries(): VideoEntry[] {
  return Object.entries(videos).map(([key, v]) => ({ key, ...v }));
}

export function getVisibleVideos(): VideoEntry[] {
  return getAllVideoEntries().filter(isVisible);
}

export function getVideoByKey(key: string): VideoEntry | undefined {
  const v = videos[key];
  return v ? { key, ...v } : undefined;
}

export function sortByPublishedDesc<T extends { published_at: string }>(list: T[]): T[] {
  return [...list].sort(
    (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
  );
}

export function getBrandName(brandId: string): string | undefined {
  return brands[brandId];
}

export function getAllBrands(): { brand_id: string; name: string }[] {
  return Object.entries(brands).map(([brand_id, name]) => ({ brand_id, name }));
}

export interface BrandWithStats {
  brand_id: string;
  name: string;
  videoCount: number;
  cosmeticCount: number;
}

/** 掲載中の動画で1つ以上コスメが紹介されているブランドだけを、動画数・コスメ数付きで返す。 */
export function getBrandsWithVideos(): BrandWithStats[] {
  const videoSets = new Map<string, Set<string>>();
  const cosmeticSets = new Map<string, Set<string>>();
  for (const v of getVisibleVideos()) {
    for (const c of v.cosmetics || []) {
      if (!c.brand_id || !c.name_id || !brands[c.brand_id]) continue;
      if (!videoSets.has(c.brand_id)) videoSets.set(c.brand_id, new Set());
      if (!cosmeticSets.has(c.brand_id)) cosmeticSets.set(c.brand_id, new Set());
      videoSets.get(c.brand_id)!.add(v.key);
      cosmeticSets.get(c.brand_id)!.add(c.name_id);
    }
  }
  return Array.from(videoSets.entries()).map(([brand_id, vs]) => ({
    brand_id,
    name: brands[brand_id],
    videoCount: vs.size,
    cosmeticCount: cosmeticSets.get(brand_id)!.size,
  }));
}

/** 紹介動画数を第一、紹介コスメ数を第二キーとした人気ブランド順。 */
export function getPopularBrands(limit: number): BrandWithStats[] {
  return getBrandsWithVideos()
    .sort((a, b) => b.videoCount - a.videoCount || b.cosmeticCount - a.cosmeticCount)
    .slice(0, limit);
}

export function cosmeticSlug(brand_id: string, name_id: string): string {
  return `${brand_id}-${name_id}`;
}

const SLUG_RE = /^(brand-\d+)-(name-\d+)$/;

export function parseCosmeticSlug(slug: string): { brand_id: string; name_id: string } | null {
  const m = slug.match(SLUG_RE);
  if (!m) return null;
  return { brand_id: m[1], name_id: m[2] };
}

export function getCosmeticListEntry(brand_id: string, name_id: string): CosmeticListEntry | undefined {
  return cosmeticsList[`${brand_id}_${name_id}`];
}

/** 動画内で実際に使われている（brand_id, name_id）の一意な組み合わせ一覧。
 * 現行WordPressの create_cosme_posts_from_json も全動画の cosmetics[] を走査して
 * 投稿を作る設計なので、cosmetics_list.json 全件(32,649)ではなくこちらを生成対象にする。 */
export function getUsedCosmeticKeys(): { brand_id: string; name_id: string }[] {
  const map = new Map<string, { brand_id: string; name_id: string }>();
  for (const v of getVisibleVideos()) {
    for (const c of v.cosmetics || []) {
      if (c.brand_id && c.name_id) {
        map.set(`${c.brand_id}_${c.name_id}`, { brand_id: c.brand_id, name_id: c.name_id });
      }
    }
  }
  return Array.from(map.values());
}

export function getVideosUsingCosmetic(brand_id: string, name_id: string): VideoEntry[] {
  return getVisibleVideos().filter((v) =>
    (v.cosmetics || []).some((c) => c.brand_id === brand_id && c.name_id === name_id)
  );
}

export function getCosmeticsForBrand(brand_id: string): Cosmetic[] {
  const map = new Map<string, Cosmetic>();
  for (const v of getVisibleVideos()) {
    for (const c of v.cosmetics || []) {
      if (c.brand_id === brand_id && c.name_id) {
        const key = `${c.brand_id}_${c.name_id}`;
        if (!map.has(key)) map.set(key, c);
      }
    }
  }
  return Array.from(map.values());
}

export function getRelatedCosmetics(brand_id: string, name_id: string, tags: string[]): CosmeticListEntry[] {
  if (!tags || tags.length === 0) return [];
  const tagSet = new Set(tags);
  const seen = new Set<string>([`${brand_id}_${name_id}`]);
  const result: CosmeticListEntry[] = [];
  for (const v of getVisibleVideos()) {
    for (const c of v.cosmetics || []) {
      if (!c.brand_id || !c.name_id) continue;
      const key = `${c.brand_id}_${c.name_id}`;
      if (seen.has(key)) continue;
      if ((c.related_tags || []).some((t) => tagSet.has(t))) {
        seen.add(key);
        const full = getCosmeticListEntry(c.brand_id, c.name_id);
        result.push(full || (c as CosmeticListEntry));
      }
    }
  }
  return result;
}

/** influencer-list は現行実装通り、可視/非可視を問わず全動画から導出する
 * （channel_title ではなく channel_id で重複排除するようバグ修正済み）。 */
export function getAllInfluencers(): Influencer[] {
  const map = new Map<string, Influencer>();
  for (const v of getAllVideoEntries()) {
    if (!v.channel_id) continue;
    if (!map.has(v.channel_id)) {
      map.set(v.channel_id, {
        channel_id: v.channel_id,
        channel_title: v.channel_title,
        channel_icon: v.channel_icon,
        subscriber_count: v.subscriber_count,
      });
    }
  }
  return Array.from(map.values());
}

export function getInfluencerByChannelId(channel_id: string): Influencer | undefined {
  return getAllInfluencers().find((i) => i.channel_id === channel_id);
}

export function getVideosByChannel(channel_id: string): VideoEntry[] {
  return getVisibleVideos().filter((v) => v.channel_id === channel_id);
}

export interface InfluencerRanking extends Influencer {
  videoCount: number;
  cosmeticCount: number;
  score: number;
}

/** 登録者数・動画数（このサイトに掲載中）・紹介コスメ数の3指標から順位付け用スコアを算出。
 * 桁の違いが大きい（登録者数は万〜百万、動画数は1〜数十、コスメ数は1〜数百）ため
 * 対数スケールに揃えたうえで合算し、視聴者数だけでなく「このサイトでの活躍度」も
 * 反映されるよう動画数・コスメ数をやや厚めに重み付けしている。 */
export function getInfluencerRanking(): InfluencerRanking[] {
  const result: InfluencerRanking[] = [];
  for (const inf of getAllInfluencers()) {
    const videos = getVideosByChannel(inf.channel_id);
    if (videos.length === 0) continue; // このサイトに掲載動画が無いインフルエンサーは除外

    const cosmeticKeys = new Set<string>();
    for (const v of videos) {
      for (const c of v.cosmetics || []) {
        if (c.brand_id && c.name_id) cosmeticKeys.add(`${c.brand_id}_${c.name_id}`);
      }
    }

    const subscriberScore = Math.log10(toNumber(inf.subscriber_count) + 1);
    const videoScore = Math.log10(videos.length + 1) * 2;
    const cosmeticScore = Math.log10(cosmeticKeys.size + 1) * 1.5;

    result.push({
      ...inf,
      videoCount: videos.length,
      cosmeticCount: cosmeticKeys.size,
      score: subscriberScore + videoScore + cosmeticScore,
    });
  }
  return result.sort((a, b) => b.score - a.score);
}

export function groupByKana(items: { name: string }[]): Map<string, typeof items> {
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const head = item.name.charAt(0);
    const key = /[ぁ-んァ-ヶ]/.test(head) ? head : "他";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  return new Map([...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "ja")));
}

/** GitHub Pagesのプロジェクトページ（サブパス配信）に対応するため、
 * astro.config.mjs の `base` をすべての内部リンクの先頭に付与するヘルパー。
 * 外部URL(https://...)には使わないこと。 */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL || "/";
  const cleanBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}

export function toNumber(n: string | number | undefined): number {
  if (n === undefined || n === null) return 0;
  const num = typeof n === "string" ? parseInt(n, 10) : n;
  return Number.isNaN(num) ? 0 : num;
}

export function formatCount(n: string | number | undefined): string {
  if (n === undefined || n === null) return "-";
  const num = typeof n === "string" ? parseInt(n, 10) : n;
  if (Number.isNaN(num)) return "-";
  return num.toLocaleString("ja-JP");
}

/** インフルエンサーのスコア(getInfluencerRanking)と同じ考え方で、動画単体の「人気」を
 * 再生回数・この動画で紹介されているコスメ数・投稿からの新しさから合成する。
 * 実データでは動画の投稿日が古いもので約3,200日、新しいものでも約200日前後と
 * 全体的に古めに偏っているため、経過730日(約2年)ごとに1点減点する緩やかな減衰にして、
 * 「多少古くても圧倒的に人気」な動画まで埋もれさせないようにしつつ、
 * 同程度の人気なら新しい方を優先する設計にしている。 */
export function getVideoScore(v: Video): number {
  const cosmeticsCount = (v.cosmetics || []).filter((c) => c.brand && c.name).length;
  const popularityScore = Math.log10(toNumber(v.view_count) + 1) + Math.log10(cosmeticsCount + 1) * 1.5;

  let recencyScore = 0;
  if (v.published_at) {
    const daysSincePublished = (Date.now() - new Date(v.published_at).getTime()) / 86_400_000;
    recencyScore = -Math.max(daysSincePublished, 0) / 730;
  }

  return popularityScore + recencyScore;
}

export interface CosmeticRanking {
  brand_id: string;
  brand: string;
  name_id: string;
  name: string;
  rakuten_image_link?: string;
  videoCount: number;
  channelCount: number;
  totalViews: number;
  score: number;
  tags: string[];
}

/** コスメ単位の人気スコア。インフルエンサー(getInfluencerRanking)と同じく、桁の違う指標を
 * 対数スケールに揃えて合算する。紹介動画数(2倍)・紹介したチャンネル数(1.5倍)を厚めに、
 * 紹介動画の合計再生回数を1倍で加える。チャンネル数を入れることで、同一インフルエンサーが
 * 何本も紹介しただけの商品より、複数の人に支持されている商品が上位に来る。 */
export function getCosmeticRankings(): CosmeticRanking[] {
  const map = new Map<string, CosmeticRanking & { videos: Set<string>; channels: Set<string>; tagSet: Set<string> }>();
  for (const v of getVisibleVideos()) {
    for (const c of v.cosmetics || []) {
      if (!c.brand_id || !c.name_id || !c.related_tags || c.related_tags.length === 0) continue;
      const key = `${c.brand_id}_${c.name_id}`;
      let e = map.get(key);
      if (!e) {
        e = {
          brand_id: c.brand_id, brand: c.brand, name_id: c.name_id, name: c.name,
          rakuten_image_link: c.rakuten_image_link,
          videoCount: 0, channelCount: 0, totalViews: 0, score: 0, tags: [],
          videos: new Set(), channels: new Set(), tagSet: new Set(),
        };
        map.set(key, e);
      }
      if (!e.rakuten_image_link && c.rakuten_image_link) e.rakuten_image_link = c.rakuten_image_link;
      c.related_tags.forEach((t) => e!.tagSet.add(t));
      if (!e.videos.has(v.key)) {
        e.videos.add(v.key);
        e.channels.add(v.channel_id);
        e.totalViews += toNumber(v.view_count);
      }
    }
  }
  return Array.from(map.values()).map(({ videos, channels, tagSet, ...e }) => ({
    ...e,
    tags: Array.from(tagSet),
    videoCount: videos.size,
    channelCount: channels.size,
    score:
      Math.log10(e.totalViews + 1) +
      Math.log10(videos.size + 1) * 2 +
      Math.log10(channels.size + 1) * 1.5,
  }));
}

/** ランキングのカテゴリ表示順。大分類（メイク→スキンケア）の中を、肌に載せる一般的な順に並べる。
 * ここに無いタグは末尾の「その他」にまとめる。 */
export const RANKING_CATEGORY_GROUPS: { group: string; tags: string[] }[] = [
  {
    group: "ベースメイク",
    tags: [
      "化粧下地", "リキッドファンデーション", "クリーム・ジェルファンデーション",
      "パウダーファンデーション", "ファンデーション", "その他ファンデーション",
      "コンシーラー", "プレストパウダー", "ルースパウダー",
    ],
  },
  {
    group: "アイブロウ",
    tags: ["アイブロウペンシル", "パウダーアイブロウ", "眉マスカラ", "その他アイブロウ", "アイブロウ"],
  },
  {
    group: "アイメイク",
    tags: [
      "パウダーアイシャドウ", "ジェル・クリームアイシャドウ", "アイシャドウ",
      "リキッドアイライナー", "ジェルアイライナー", "ペンシルアイライナー", "その他アイライナー",
      "マスカラ下地・トップコート", "マスカラ", "つけまつげ", "まつげ美容液",
      "二重まぶた用グッズ", "カラコン",
    ],
  },
  {
    group: "チーク・リップ",
    tags: [
      "パウダーチーク", "ジェル・クリームチーク",
      "リップライナー", "口紅", "リップスティック", "リップグロス", "リップケア・リップクリーム",
      "ポイントメイクリムーバー",
    ],
  },
  {
    group: "メイク小物・その他",
    tags: ["メイクアップキット・パレット", "メイクブラシ", "パフ・スポンジ", "ビューラー", "コットン"],
  },
  {
    group: "スキンケア",
    tags: [
      "オイルクレンジング", "クレンジングジェル", "クレンジングクリーム", "ミルククレンジング",
      "リキッドクレンジング", "その他クレンジング", "ゴマージュ・ピーリング",
      "ブースター・導入液", "化粧水", "ミスト状化粧水", "美容液", "シートマスク・パック",
      "乳液", "フェイスクリーム", "乳液・クリーム", "オールインワン化粧品",
      "アイケア・アイクリーム", "フェイスオイル・バーム", "日焼け止め・UVケア(顔用)",
      "ハンドクリーム・ケア", "ハンドソープ・ジェル", "スキンケア美容家電",
    ],
  },
];

/** タグ一覧を RANKING_CATEGORY_GROUPS の大分類・表示順に並べ直す。定義に無いタグは「その他」へ。 */
export function groupTagsByCategory(tags: Iterable<string>): { group: string; tags: string[] }[] {
  const present = new Set(tags);
  const known = new Set(RANKING_CATEGORY_GROUPS.flatMap((g) => g.tags));
  const unknown = Array.from(present).filter((t) => !known.has(t)).sort((a, b) => a.localeCompare(b, "ja"));
  return [...RANKING_CATEGORY_GROUPS, { group: "その他", tags: unknown }]
    .map((g) => ({ group: g.group, tags: g.tags.filter((t) => present.has(t)) }))
    .filter((g) => g.tags.length > 0);
}
