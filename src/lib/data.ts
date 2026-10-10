import videosData from "../data/videos.json";
import brandsData from "../data/brands-list.json";
import cosmeticsListData from "../data/cosmetics_list.json";
import brandMetaData from "../data/brand-meta.json";
import brandReadings from "../data/brand-readings.json";
import categoryOverridesData from "../data/category-overrides.json";
import brandEquivalentsData from "../data/brand_equivalents.json";
import prVideosData from "../data/pr_videos.json";
import shortsData from "../data/shorts.json";
import ingredientsData from "../data/ingredients.json";
import productRedirectsData from "../data/product-redirects.json";

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
  /** 動画の中で紹介された時刻（"m:ss" または "h:mm:ss"）。266章の試し */
  time_in_video?: string;
}

export interface Video {
  video_id: string;
  title: string;
  description: string;
  thumbnail: string;
  url: string;
  published_at: string;
  /** 商品データがサイトで最後に変わった日（YYYY-MM-DD）。公開時に stamp_updated_at.py が付ける。無い動画は published_at を使う */
  updated_at?: string;
  channel_title: string;
  channel_id: string;
  channel_icon?: string;
  subscriber_count?: string | number;
  view_count?: string | number;
  duration?: string;
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
  /** now_price を楽天で確認した日（YYYY-MM-DD）。無い商品は日付を表示しない */
  price_updated?: string;
  count?: number;
  rakuten_link_none?: boolean;
  /** Yahoo!ショッピングのアフィリエイトリンク（バリューコマース経由、backend/scripts/update_yahoo_links.py が取得） */
  yahoo_text_link?: string;
  yahoo_image_url?: string;
  yahoo_price?: number;
  /** yahoo_price を確認した日（YYYY-MM-DD） */
  yahoo_price_updated?: string;
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

/** 商品のカテゴリの補正（src/data/category-overrides.json）。
 * 商品マスタのカテゴリが実際の種類とずれている商品（例: クッションファンデが化粧下地、アイ用の下地が化粧下地）を、
 * ランキング・カテゴリ表示の全体に一貫して反映するため、読み込み時に動画側のタグと商品マスタのカテゴリを書き換える。
 * マスタ側は更新で上書きされうるため、サイト側で補正する。キー: "brand_id_name_id"。 */
{
  const overrides = categoryOverridesData as unknown as Record<string, { category: string }>;
  for (const v of Object.values(videos)) {
    for (const c of v.cosmetics || []) {
      const o = overrides[`${c.brand_id}_${c.name_id}`];
      // カテゴリが空欄の商品（related_tags が空）にも付ける。付けないとランキングに入らない（119章）
      if (o) c.related_tags = [o.category];
    }
  }
  for (const [key, o] of Object.entries(overrides)) {
    if (cosmeticsList[key]) cosmeticsList[key].category = o.category;
  }
}

/** 二重登録ブランド（同じブランドが別のbrand_idで二重に登録されているもの。brand_equivalents.json）の統合。
 * - ブランドページ・一覧・集計は、グループ内で最も小さいbrand_id（＝先に登録された方）に1本化する（canonicalBrandId）。
 * - 商品は、統合先ブランドに同じ名前の商品があれば、その商品に寄せる（動画側の参照を書き換え、紹介数を合算する）。
 *   無いものは商品のIDをそのまま残し（URLを変えない）、表示上のブランド名だけ統合先に揃える。
 * - 統合前のURL（ブランドページ・寄せた商品のページ）は、統合先へ転送するページを出す（getAliasRedirects）。
 * - site_separate に挙げた派生ブランド（ポーラとホワイトショット・B.Aなど）は、照合では同じグループだが、
 *   サイトでは統合しない（統合すると、ホワイトショットの商品が「B.A」として出るなど、ブランド名を取り違える。116章）。 */
const equivalents = brandEquivalentsData as unknown as { groups: string[][]; site_separate?: string[] };
const siteSeparate = new Set(equivalents.site_separate ?? []);
const canonicalOf: Record<string, string> = {};
for (const g of equivalents.groups) {
  const merged = g.filter((id) => !siteSeparate.has(id));
  if (merged.length < 2) continue;
  const c = [...merged].sort()[0];
  for (const id of merged) canonicalOf[id] = c;
}

export function canonicalBrandId(brand_id: string): string {
  return canonicalOf[brand_id] ?? brand_id;
}

const productAlias: Record<string, string> = {}; // "統合前brand_id_name_id" -> "統合先brand_id_name_id"
{
  const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\s・･·.\-_&＆'’!！()（）]/g, "");
  const canonByName = new Map<string, string>();
  for (const [key, e] of Object.entries(cosmeticsList)) {
    if (canonicalOf[e.brand_id] === e.brand_id) canonByName.set(`${e.brand_id}|${norm(e.name)}`, key);
  }
  for (const [key, e] of Object.entries(cosmeticsList)) {
    const c = canonicalOf[e.brand_id];
    if (!c || c === e.brand_id) continue;
    const target = canonByName.get(`${c}|${norm(e.name)}`);
    if (target && target !== key) {
      productAlias[key] = target;
      const t = cosmeticsList[target];
      // 統合先に無い楽天・Yahoo!のリンク・画像・価格は、統合前の商品から補う
      for (const f of ["rakuten_image_link", "rakuten_text_link", "amazon_link", "now_price", "price_updated", "yahoo_text_link", "yahoo_image_url", "yahoo_price", "yahoo_price_updated"] as const) {
        if (!t[f] && e[f]) (t as any)[f] = e[f];
      }
    } else {
      e.brand = brands[c] ?? e.brand;
    }
  }
  for (const v of Object.values(videos)) {
    if (!v.cosmetics) continue;
    const seen = new Set<string>();
    v.cosmetics = v.cosmetics.filter((c) => {
      const alias = productAlias[`${c.brand_id}_${c.name_id}`];
      if (alias) {
        const t = cosmeticsList[alias];
        c.brand_id = t.brand_id; c.name_id = t.name_id; c.brand = t.brand; c.name = t.name;
      } else if (canonicalOf[c.brand_id] && canonicalOf[c.brand_id] !== c.brand_id) {
        c.brand = brands[canonicalOf[c.brand_id]] ?? c.brand;
      }
      const k = `${c.brand_id}_${c.name_id}`;
      if (seen.has(k)) return false; // 同じ動画で統合前・統合後の両方に載っていたものは1つにする
      seen.add(k);
      return true;
    });
  }
}

// 楽天のリンク・画像・価格は cosmetics_list だけに持つ（videos.json の写しは267章でやめた）。動画の商品には、ここで写して使う
for (const v of Object.values(videos)) {
  for (const c of v.cosmetics ?? []) {
    const e = cosmeticsList[`${c.brand_id}_${c.name_id}`];
    if (!e) continue;
    c.rakuten_image_link = e.rakuten_image_link;
    c.rakuten_text_link = e.rakuten_text_link;
    c.now_price = e.now_price;
  }
}

/** 統合前のURLから統合先への転送先。ブランドページと、統合先の商品に寄せた商品のページ。 */
export function getAliasRedirects(): { brands: { from: string; to: string }[]; products: { from: string; to: string }[] } {
  return {
    // 統合先にページが無い（動画で紹介された商品が無い）ブランドは、転送ページを作らない（転送先が404になるため。116章）
    brands: Object.entries(canonicalOf)
      .filter(([id, c]) => id !== c && brandsWithPages().has(c))
      .map(([from, to]) => ({ from, to })),
    products: Object.entries(productAlias).map(([from, to]) => ({
      from: from.replace("_", "-"),
      to: to.replace("_", "-"),
    })),
  };
}

/** 表記揺れの統合（backend の lib/dedupe.py）で寄せた商品の旧URLから、寄せ先の商品ページへの転送先。
 * 対応表は公開時に trim_public_catalog.py が書く（{寄せた側のキー: 寄せ先のキー}）。寄せ先にページがあるものだけ。
 * 二重登録ブランドの統合の転送（getAliasRedirects）と重なるものは、そちらを優先する。251章 */
export function getProductRedirects(): { from: string; to: string }[] {
  const used = new Set(getUsedCosmeticKeys().map((k) => `${k.brand_id}_${k.name_id}`));
  const aliasFrom = new Set(Object.keys(productAlias));
  const out: { from: string; to: string }[] = [];
  for (const [from, to0] of Object.entries(productRedirectsData as Record<string, string>)) {
    const to = productAlias[to0] ?? to0;
    if (used.has(from) || aliasFrom.has(from) || !used.has(to)) continue;
    out.push({ from: from.replace("_", "-"), to: to.replace("_", "-") });
  }
  return out;
}

/** 現行WordPress実装は check_status の判定がページごとに不統一（緩い/厳密が混在するバグ）。
 * ここでは常に厳密判定（boolean true のみ有効）に統一する。 */
export function isVisible(v: Video): boolean {
  return v.check_status === true && v.delete_flg !== true;
}

/** YouTubeのサムネイル。データには320×180の mqdefault しか無く、大きく出すと粗いので、
 * 表示の幅に合わせて hqdefault（480×360）・sddefault（640×480）も選べるようにする（hq・sd は上下の黒帯を aspect-video の切り抜きで落とす）。
 * sddefault はまれに無い（120×90 の灰色の画像が返る）ので、その場合は srcset を外して hqdefault に戻す（THUMB_FALLBACK）。213章 */
export function ytThumb(url: string): { src: string; srcset?: string } {
  const m = url?.match(/^(https:\/\/i\.ytimg\.com\/vi\/[^/]+)\/(?:mq|hq|sd|maxres)?default\.jpg$/);
  if (!m) return { src: url };
  return { src: `${m[1]}/hqdefault.jpg`, srcset: `${m[1]}/mqdefault.jpg 320w, ${m[1]}/hqdefault.jpg 480w, ${m[1]}/sddefault.jpg 640w` };
}
export const THUMB_FALLBACK = "if(this.naturalWidth<200&&this.srcset)this.removeAttribute('srcset')";
/** 共有用の画像（og:image）など、1枚だけ渡すときの大きめのサムネイル（必ずある hqdefault） */
export function ytThumbLarge(url: string): string {
  return ytThumb(url).src;
}

/** YouTubeのショートか（公開時に backend/scripts/detect_shorts.py が /shorts/ のURLで判定。3分を超える動画は調べないので false。213章） */
const SHORTS = shortsData as Record<string, boolean>;
export function isShort(v: Video): boolean {
  return SHORTS[v.video_id] === true;
}

/** PR・提供の動画（backend/scripts/pr_check/classify.py が概要欄・YouTubeの有料プロモーションの申告から判定。197章）。
 * kind: gift=提供品を含む、pr=PR・提供。whole=動画の商品をすべて外す（提供元が書かれていない・店舗の提供）、
 * brands・products=外すブランド・商品（brand_id_name_id）。 */
export interface PrInfo {
  kind: "pr" | "gift";
  whole: boolean;
  brands: string[];
  products: string[];
}
const PR_VIDEOS = prVideosData as unknown as Record<string, PrInfo>;
export function getPrInfo(videoKey: string): PrInfo | undefined {
  return videoKey === "_comment" ? undefined : PR_VIDEOS[videoKey];
}
/** PR・提供としての紹介か。ランキング・最近話題・特集の数には入れない（紹介の一覧には「PR」を付けて残す。197章） */
export function isPrMention(videoKey: string, brand_id: string, name_id: string): boolean {
  const p = getPrInfo(videoKey);
  if (!p) return false;
  return p.whole || p.brands.includes(brand_id) || p.products.includes(`${brand_id}_${name_id}`);
}

export function getAllVideoEntries(): VideoEntry[] {
  return Object.entries(videos).map(([key, v]) => ({ key, ...v }));
}

// ビルドが長くなった（12,000ページで15分）ので、掲載中の動画の一覧と、商品・チャンネルから動画を引く索引を1回だけ作る（228章）。
// 呼び出し側が並べ替えても壊れないよう、返すのは毎回コピー（要素の動画は共有）
let _visibleCache: VideoEntry[] | null = null;
let _byCosmetic: Map<string, VideoEntry[]> | null = null;
let _byChannel: Map<string, VideoEntry[]> | null = null;
function visibleVideosShared(): VideoEntry[] {
  if (!_visibleCache) _visibleCache = getAllVideoEntries().filter(isVisible);
  return _visibleCache;
}
function videoIndexes() {
  if (!_byCosmetic || !_byChannel) {
    _byCosmetic = new Map();
    _byChannel = new Map();
    for (const v of visibleVideosShared()) {
      const ch = _byChannel.get(v.channel_id);
      if (ch) ch.push(v);
      else _byChannel.set(v.channel_id, [v]);
      const seen = new Set<string>();
      for (const c of v.cosmetics || []) {
        const k = `${c.brand_id}_${c.name_id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const list = _byCosmetic.get(k);
        if (list) list.push(v);
        else _byCosmetic.set(k, [v]);
      }
    }
  }
  return { byCosmetic: _byCosmetic, byChannel: _byChannel };
}

export function getVisibleVideos(): VideoEntry[] {
  return visibleVideosShared().slice();
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
let brandsWithPagesCache: Set<string> | undefined;
/** ブランドページが作られるbrand_id（getBrandsWithVideos と同じ基準） */
function brandsWithPages(): Set<string> {
  return (brandsWithPagesCache ??= new Set(getBrandsWithVideos().map((b) => b.brand_id)));
}

let _brandsWithVideos: BrandWithStats[] | null = null;
export function getBrandsWithVideos(): BrandWithStats[] {
  if (!_brandsWithVideos) _brandsWithVideos = buildBrandsWithVideos();
  return _brandsWithVideos.map((b) => ({ ...b }));
}
function buildBrandsWithVideos(): BrandWithStats[] {
  const videoSets = new Map<string, Set<string>>();
  const cosmeticSets = new Map<string, Set<string>>();
  for (const v of getVisibleVideos()) {
    for (const c of v.cosmetics || []) {
      if (!c.brand_id || !c.name_id || !brands[canonicalBrandId(c.brand_id)]) continue;
      const bid = canonicalBrandId(c.brand_id);
      if (!videoSets.has(bid)) videoSets.set(bid, new Set());
      if (!cosmeticSets.has(bid)) cosmeticSets.set(bid, new Set());
      videoSets.get(bid)!.add(v.key);
      cosmeticSets.get(bid)!.add(`${c.brand_id}_${c.name_id}`);
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

/** 楽天の商品画像のURLを、同じ画像の大きいサイズ（最大500×500）に置き換える（試作） */
export function largerRakutenImage(src: string, size = 500): string {
  return src.replace(/(thumbnail\.image\.rakuten\.co\.jp\/.*[?&]_ex=)\d+x\d+/, `$1${size}x${size}`);
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

// 紹介動画がこの本数に満たない商品ページは noindex にし、サイトマップにも載せない。
// 「検出 - インデックス未登録」が4千件余りあり、クロールを紹介の多いページ・人・ランキングに集めるため（履歴171章）
export const COSMETIC_INDEX_MIN_VIDEOS = 2;

export function getVideosUsingCosmetic(brand_id: string, name_id: string): VideoEntry[] {
  return (videoIndexes().byCosmetic.get(`${brand_id}_${name_id}`) || []).slice();
}

let _videoCountCache: Map<string, number> | null = null;
/** 商品ごとの紹介動画数（公開中の動画。カテゴリの無い商品も含む）。キーは `${brand_id}_${name_id}` */
export function getCosmeticVideoCounts(): Map<string, number> {
  if (_videoCountCache) return _videoCountCache;
  const m = new Map<string, number>();
  for (const v of getVisibleVideos()) {
    const seen = new Set<string>();
    for (const c of v.cosmetics || []) {
      if (!c.brand_id || !c.name_id) continue;
      const key = `${c.brand_id}_${c.name_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      m.set(key, (m.get(key) || 0) + 1);
    }
  }
  return (_videoCountCache = m);
}

export function getCosmeticsForBrand(brand_id: string): Cosmetic[] {
  const map = new Map<string, Cosmetic>();
  for (const v of getVisibleVideos()) {
    for (const c of v.cosmetics || []) {
      if (c.brand_id && canonicalBrandId(c.brand_id) === brand_id && c.name_id) {
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
let _influencers: Influencer[] | null = null;
export function getAllInfluencers(): Influencer[] {
  if (!_influencers) _influencers = buildAllInfluencers();
  return _influencers.slice();
}
function buildAllInfluencers(): Influencer[] {
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

let _influencerById: Map<string, Influencer> | null = null;
export function getInfluencerByChannelId(channel_id: string): Influencer | undefined {
  if (!_influencerById) _influencerById = new Map(getAllInfluencers().map((i) => [i.channel_id, i]));
  return _influencerById.get(channel_id);
}

export function getVideosByChannel(channel_id: string): VideoEntry[] {
  return (videoIndexes().byChannel.get(channel_id) || []).slice();
}

// チャンネルごとの紹介コスメ（brand_id_name_id）の集合。人どうし・カテゴリと人をつなぐ内部リンクに使う（履歴171章）
let _channelCosmetics: Map<string, { inf: Influencer; keys: Set<string> }> | undefined;
function getChannelCosmetics(): Map<string, { inf: Influencer; keys: Set<string> }> {
  if (_channelCosmetics) return _channelCosmetics;
  const map = new Map<string, { inf: Influencer; keys: Set<string> }>();
  for (const v of getVisibleVideos()) {
    if (!v.channel_id) continue;
    let e = map.get(v.channel_id);
    if (!e) {
      e = { inf: { channel_id: v.channel_id, channel_title: v.channel_title, channel_icon: v.channel_icon }, keys: new Set() };
      map.set(v.channel_id, e);
    }
    for (const c of v.cosmetics || []) if (c.brand_id && c.name_id) e.keys.add(`${c.brand_id}_${c.name_id}`);
  }
  _channelCosmetics = map;
  return map;
}

export interface InfluencerMatch extends Influencer {
  count: number; // 共通の（またはそのカテゴリの）紹介コスメ数
}

/** 紹介コスメが近いインフルエンサー。共通の紹介コスメ数が多い順（同数なら紹介コスメが少ない＝好みが近い人を先に）。 */
export function getSimilarInfluencers(channel_id: string, limit = 6, minCommon = 3): InfluencerMatch[] {
  const all = getChannelCosmetics();
  const mine = all.get(channel_id)?.keys;
  if (!mine || mine.size === 0) return [];
  const result: (InfluencerMatch & { size: number })[] = [];
  for (const [id, e] of all) {
    if (id === channel_id) continue;
    let n = 0;
    for (const k of e.keys) if (mine.has(k)) n++;
    if (n >= minCommon) result.push({ ...e.inf, count: n, size: e.keys.size });
  }
  return result
    .sort((a, b) => b.count - a.count || a.size - b.size)
    .slice(0, limit)
    .map(({ size: _size, ...r }) => r);
}

/** 指定したコスメ群（ランキングのカテゴリ）を多く紹介しているインフルエンサー。 */
export function getTopInfluencersForCosmetics(keys: Set<string>, limit = 8, minCount = 2): InfluencerMatch[] {
  const result: InfluencerMatch[] = [];
  for (const e of getChannelCosmetics().values()) {
    let n = 0;
    for (const k of e.keys) if (keys.has(k)) n++;
    if (n >= minCount) result.push({ ...e.inf, count: n });
  }
  return result.sort((a, b) => b.count - a.count).slice(0, limit);
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
let _influencerRanking: InfluencerRanking[] | null = null;
export function getInfluencerRanking(): InfluencerRanking[] {
  if (!_influencerRanking) _influencerRanking = buildInfluencerRanking();
  return _influencerRanking.slice();
}
function buildInfluencerRanking(): InfluencerRanking[] {
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

let _globalTagShare: Map<string, number> | null = null;
/** 掲載中の全動画で、紹介コスメ（動画ごとに重複を除く）のうち各カテゴリが占める割合。 */
function getGlobalTagShare(): Map<string, number> {
  if (_globalTagShare) return _globalTagShare;
  const counts = new Map<string, number>();
  let total = 0;
  for (const v of getVisibleVideos()) {
    const seen = new Set<string>();
    for (const c of v.cosmetics || []) {
      if (!c.brand_id || !c.name_id) continue;
      const key = `${c.brand_id}_${c.name_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      total++;
      for (const t of c.related_tags || []) counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  _globalTagShare = new Map(Array.from(counts.entries()).map(([t, n]) => [t, n / Math.max(total, 1)]));
  return _globalTagShare;
}

export interface InfluencerTopCosmetic {
  brand_id: string;
  brand: string;
  name_id: string;
  name: string;
  imageSrc: string;
  /** そのインフルエンサーが、この商品を紹介した動画の本数 */
  videoCount: number;
}

export interface InfluencerHighlights {
  /** 最新の動画（投稿日降順） */
  latestVideos: VideoEntry[];
  /** よく紹介するコスメ（紹介した動画数の多い順。画像のあるものだけ。PR・提供の紹介は数えない） */
  topCosmetics: InfluencerTopCosmetic[];
  /** 紹介が多いカテゴリ。全体の平均より、そのインフルエンサーが多く紹介しているものを優先（特徴が出る）。 */
  topTags: string[];
}

/** インフルエンサー一覧の上位カード用に、最新動画・よく紹介するコスメ・得意カテゴリを集計する。 */
export function getInfluencerHighlights(channel_id: string, videoLimit = 3, cosmeticLimit = 6, tagLimit = 3): InfluencerHighlights {
  const videos = sortByPublishedDesc(getVideosByChannel(channel_id));
  const byCosmetic = new Map<string, InfluencerTopCosmetic>();
  const tagCounts = new Map<string, number>();
  let mentions = 0; // 紹介コスメの延べ数（動画内の重複は1つと数える）
  for (const v of videos) {
    const seen = new Set<string>();
    for (const c of v.cosmetics || []) {
      if (!c.brand_id || !c.name_id || !c.brand || !c.name) continue;
      if (isPrMention(v.key, c.brand_id, c.name_id)) continue; // PR・提供の紹介は「よく紹介する」に数えない（197章）
      const key = `${c.brand_id}_${c.name_id}`;
      if (seen.has(key)) continue; // 同じ動画内の重複は1本と数える
      seen.add(key);
      mentions++;
      for (const t of c.related_tags || []) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
      const entry = getCosmeticListEntry(c.brand_id, c.name_id);
      const imageSrc = productImageSrc(entry, c.rakuten_image_link);
      const cur = byCosmetic.get(key);
      if (cur) {
        cur.videoCount += 1;
        if (!cur.imageSrc && imageSrc) cur.imageSrc = imageSrc;
      } else {
        byCosmetic.set(key, { brand_id: c.brand_id, brand: c.brand, name_id: c.name_id, name: c.name, imageSrc: imageSrc || "", videoCount: 1 });
      }
    }
  }
  const topCosmetics = Array.from(byCosmetic.values())
    .filter((c) => c.imageSrc)
    .sort((a, b) => b.videoCount - a.videoCount)
    .slice(0, cosmeticLimit);
  // 紹介が多いカテゴリ：全体の平均より多く紹介しているもの（倍率が高い順）。
  // 件数が少ないカテゴリが偶然高い倍率になるのを避けるため、一定の件数・割合があるものだけを対象にする。
  // 足りなければ、単純に紹介数の多いカテゴリで補う。
  const global = getGlobalTagShare();
  const ranked = Array.from(tagCounts.entries())
    .map(([tag, n]) => ({ tag, n, share: n / Math.max(mentions, 1), lift: n / Math.max(mentions, 1) / Math.max(global.get(tag) || 0.001, 0.001) }))
    .sort((a, b) => b.n - a.n);
  const distinctive = ranked.filter((r) => r.n >= 3 && r.share >= 0.06 && r.lift >= 1.3).sort((a, b) => b.lift - a.lift);
  const topTags = [...distinctive, ...ranked.filter((r) => !distinctive.includes(r))].slice(0, tagLimit).map((r) => r.tag);
  return { latestVideos: videos.slice(0, videoLimit), topCosmetics, topTags };
}

/** ブランドの読み仮名（英字・漢字の名前のブランド用。カナ始まりの名前には無い）。 */
export function getBrandReading(brand_id: string): string | undefined {
  return (brandReadings as Record<string, string>)[brand_id];
}

const toKatakana = (s: string) => s.replace(/[ぁ-ん]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

/** 読み（無ければ名前）の先頭文字で五十音の見出しに分ける。英字・漢字名も読みで統一する。 */
export function groupByKana(items: { name: string; brand_id?: string }[]): Map<string, typeof items> {
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const reading = item.brand_id ? getBrandReading(item.brand_id) : undefined;
    const head = toKatakana((reading ?? item.name).charAt(0));
    const key = /[ァ-ヶ]/.test(head) ? head : "他";
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
  return `${cleanBase}${withTrailingSlash(cleanPath)}`;
}

/** ページのURLは末尾スラッシュ付きが正（canonicalもそう）。スラッシュ無しで書くと、ホスティングが301で転送するため、
 * 内部リンクやsitemapが全部リダイレクト経由になり、Search Consoleに「ページにリダイレクトがあります」と出て、クロールも無駄になる。
 * ファイル（.xml / .png / .json / .txt など、拡張子付き）と、?クエリ・#ハッシュ付きの部分はそのまま。 */
export function withTrailingSlash(path: string): string {
  const m = path.match(/^([^?#]*)([?#].*)?$/);
  const p = m?.[1] ?? path;
  const rest = m?.[2] ?? "";
  if (p.endsWith("/") || /\.[A-Za-z0-9]{1,5}$/.test(p.split("/").pop() || "")) return path;
  return `${p}/${rest}`;
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
let _rankingsCache: CosmeticRanking[] | null = null;
/** ランキングで、細かく分かれたカテゴリを主なカテゴリに寄せる（後から増えた細かいカテゴリ。120章）。
 * 商品ページの「カテゴリ」表示は元のまま。ランキング・一覧・特集の分類だけに使う。 */
export const RANKING_TAG_ALIAS: Record<string, string> = {
  リキッドルージュ: "口紅",
  リップスティック: "口紅",
  リキッドコンシーラー: "コンシーラー",
  スティックコンシーラー: "コンシーラー",
  コンシーラーパレット: "コンシーラー",
  BBクリーム: "BB・CCクリーム",
  CCクリーム: "BB・CCクリーム",
  リキッドチーク: "ジェル・クリームチーク",
  スティックアイシャドウ: "ジェル・クリームアイシャドウ",
  拭き取り化粧水: "化粧水",
  リキッドアイブロウ: "その他アイブロウ",
  "スリーピングマスク・パック": "シートマスク・パック",
  カラーリップケア: "リップケア・リップクリーム", // 265章
};
export function rankingTag(tag: string): string {
  return RANKING_TAG_ALIAS[tag] ?? tag;
}
/** この品数に満たないカテゴリは、ランキングのページを作らない（一覧・サイトマップにも出さない。120章） */
export const MIN_RANKING_ITEMS = 6;

export function getCosmeticRankings(): CosmeticRanking[] {
  if (_rankingsCache) return _rankingsCache;
  const map = new Map<string, CosmeticRanking & { videos: Set<string>; channels: Set<string>; tagSet: Set<string> }>();
  for (const v of getVisibleVideos()) {
    for (const c of v.cosmetics || []) {
      // カテゴリ（related_tags）の付いていない紹介も、動画数・人数には数える。以前は飛ばしていたので、
      // 商品ページの「紹介動画187本」とランキングの「177本」のように数字が食い違っていた（255品。195章）。
      // どの紹介にもカテゴリが無い商品は、順位を付けられないので最後に除く。
      if (!c.brand_id || !c.name_id) continue;
      if (isPrMention(v.key, c.brand_id, c.name_id)) continue; // PR・提供の紹介は数えない（197章）
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
      (c.related_tags || []).forEach((t) => e!.tagSet.add(rankingTag(t)));
      if (!e.videos.has(v.key)) {
        e.videos.add(v.key);
        e.channels.add(v.channel_id);
        e.totalViews += toNumber(v.view_count);
      }
    }
  }
  _rankingsCache = Array.from(map.values()).filter((e) => e.tagSet.size > 0).map(({ videos, channels, tagSet, ...e }) => ({
    ...e,
    tags: Array.from(tagSet),
    videoCount: videos.size,
    channelCount: channels.size,
    score:
      Math.log10(e.totalViews + 1) +
      Math.log10(videos.size + 1) * 2 +
      Math.log10(channels.size + 1) * 1.5,
  }));
  return _rankingsCache;
}

/** ランキングのカテゴリ表示順。大分類（メイク→スキンケア）の中を、肌に載せる一般的な順に並べる。
 * ここに無いタグは末尾の「その他」にまとめる。 */
export const RANKING_CATEGORY_GROUPS: { group: string; tags: string[] }[] = [
  {
    group: "ベースメイク",
    tags: [
      "化粧下地", "リキッドファンデーション", "クリーム・ジェルファンデーション",
      "パウダーファンデーション", "ファンデーション", "その他ファンデーション",
      "クッションファンデ", "BB・CCクリーム",
      "コンシーラー",
      "プレストパウダー", "ルースパウダー", "ハイライト", "シェーディング",
    ],
  },
  {
    group: "アイブロウ",
    tags: ["アイブロウペンシル", "パウダーアイブロウ", "眉マスカラ", "その他アイブロウ", "アイブロウ"],
  },
  {
    group: "アイメイク",
    tags: [
      "パウダーアイシャドウ", "ジェル・クリームアイシャドウ", "アイシャドウ", "アイシャドウパレット", "アイシャドウベース",
      "リキッドアイライナー", "ジェルアイライナー", "ペンシルアイライナー", "その他アイライナー",
      "マスカラ下地・トップコート", "マスカラ", "つけまつげ", "まつげ美容液",
      "二重まぶた用グッズ", "カラコン",
    ],
  },
  {
    group: "チーク・リップ",
    tags: [
      "パウダーチーク", "ジェル・クリームチーク",
      "リップライナー", "口紅", "リップグロス", "リップケア・リップクリーム",
      "ポイントメイクリムーバー",
    ],
  },
  {
    group: "メイク小物・その他",
    tags: ["メイクアップキット・パレット", "メイクブラシ", "パフ・スポンジ", "ビューラー", "コットン",
      "化粧ポーチ", "その他メイクグッズ", "その他キットセット", "その他グッズ"],
  },
  {
    group: "スキンケア",
    tags: [
      "オイルクレンジング", "クレンジングバーム", "クレンジングジェル", "クレンジングクリーム", "ミルククレンジング",
      "リキッドクレンジング", "その他クレンジング", "ゴマージュ・ピーリング",
      "ブースター・導入液", "化粧水", "ミスト状化粧水", "美容液", "シートマスク・パック",
      "乳液", "フェイスクリーム", "乳液・クリーム", "オールインワン化粧品",
      "アイケア・アイクリーム", "フェイスオイル・バーム", "日焼け止め・UVケア(顔用)", "日焼け止めクリーム",
      "洗顔ジェル", "泡洗顔", "洗顔フォーム", "洗顔石鹸", "洗顔パウダー", "その他洗顔料", "トナーパッド",
      "ハンドクリーム・ケア", "ハンドソープ・ジェル", "スキンケア美容家電",
      // 147章：後から商品マスタに入ったカテゴリ
      "洗い流すパック・マスク", "スキンケアキット", "トライアル・トラベルキット", "ネック・デコルテケア",
      "あぶらとり紙", "美容家電", "その他スキンケア", "その他スキンケアグッズ",
    ],
  },
  {
    group: "ヘアケア",
    tags: [
      "シャンプー・コンディショナー", "ヘアパック・トリートメント", "アウトバストリートメント", "頭皮ケア",
      "ヘアワックス・クリーム", "ヘアスプレー・ヘアミスト", "ヘアジェル", "ヘアムース", "プレスタイリング・寝ぐせ直し",
      "その他ヘアスタイリング", "パーマ液", "白髪染め・ヘアカラー・ブリーチ", "ヘアマスカラ", "ヘアフレグランス", "ヘアケアグッズ", "ヘアケア美容家電",
    ],
  },
  {
    group: "ボディケア",
    tags: [
      "ボディソープ", "ボディ石鹸", "ボディスクラブ", "ボディクリーム・オイル", "ボディローション・ミルク",
      "日焼け止め・UVケア(ボディ用)", "日焼け止めスプレー", "デオドラント・制汗剤", "デオドラント・制汗剤・汗ケア", "脱毛・除毛", "脱毛・除毛ケア",
      "入浴剤", "入浴剤・浴用料", "ボディ・バスグッズ", "ボディマッサージ", "マッサージ料", "ボディケア美容家電",
      "バストアップ・ヒップケア", "バストケア・ヒップケア", "レッグ・フットケア", "デリケートゾーンケア", "その他ボディケア",
    ],
  },
  {
    group: "ネイル",
    tags: ["マニキュア", "ネイルトップコート・ベースコート", "ネイルケア", "ネイル用品", "除光液", "つけ爪・ネイルチップ"],
  },
  {
    group: "フレグランス",
    tags: ["香水・フレグランス(レディース・ウィメンズ)", "香水・フレグランス(メンズ)", "香水・フレグランス(その他)", "オードパルファム", "オードトワレ", "オーデコロン"],
  },
];

/** 動画の中の商品のカテゴリ（補正後の related_tags の先頭。無ければ商品マスタのカテゴリ）。動画ページ・インフルエンサーのページのカードに出す（213章） */
export function cosmeticCategory(c: { brand_id: string; name_id: string; related_tags?: string[] }): string | undefined {
  return c.related_tags?.[0] || getCosmeticListEntry(c.brand_id, c.name_id)?.category || undefined;
}
/** タグ一覧を RANKING_CATEGORY_GROUPS の大分類・表示順に並べ直す。定義に無いタグは「その他」へ。 */
export function groupTagsByCategory(tags: Iterable<string>): { group: string; tags: string[] }[] {
  const present = new Set(tags);
  const known = new Set(RANKING_CATEGORY_GROUPS.flatMap((g) => g.tags));
  const unknown = Array.from(present).filter((t) => !known.has(t)).sort((a, b) => a.localeCompare(b, "ja"));
  return [...RANKING_CATEGORY_GROUPS, { group: "その他", tags: unknown }]
    .map((g) => ({ group: g.group, tags: g.tags.filter((t) => present.has(t)) }))
    .filter((g) => g.tags.length > 0);
}

const CATEGORY_TAG_TO_GROUP: Record<string, string> = Object.fromEntries(
  RANKING_CATEGORY_GROUPS.flatMap((g) => g.tags.map((t) => [t, g.group]))
);

/** 特集ページ（/feature/<slug>/）。動画の**タイトルに明記された語**で動画を絞り、その動画で紹介されたコスメを集計する。
 * 肌質・パーソナルカラーのラベル（skin_profile）は、6〜9割がタイトル・概要欄・字幕に根拠の無いAIの推測だったため、軸に使わない。 */
export interface FeatureDef {
  slug: string;
  name: string;
  /** 一覧の表紙に大きく敷く英語名（CoverArt） */
  en?: string;
  /** タイトルにこのうちどれかを含む動画を対象にする */
  keywords: string[];
  lead: string;
  /** 載せる大分類を絞る（例: スキンケアの特集にメイクの商品を載せない）。省略時はすべて */
  groups?: string[];
  /** 公開日（JST、YYYY-MM-DD）。この日より前のビルドでは、ページ・一覧・サイトマップ・ホームのどこにも出さない。
   * 特集を一度に増やすと低品質な量産ページと見られるおそれがあるため、間隔を空けて1本ずつ出す（178章） */
  publishFrom?: string;
  /** 直近この日数に投稿された動画だけを集計する（新作・ベスコスなど、古い動画が混ざると意味が変わる軸。178章） */
  recentDays?: number;
  /** 大分類ごとに載せる品数（省略時 FEATURE_PER_GROUP）。大分類を1つに絞った特集で増やす */
  perGroup?: number;
}
export const FEATURES: FeatureDef[] = [
  {
    slug: "daily-makeup",
    en: "Daily",
    name: "毎日メイク",
    keywords: ["毎日メイク", "デイリーメイク"],
    lead: "インフルエンサーが日々のメイクで使っているコスメを、「毎日メイク」動画から集めました。特別な日ではなく普段使いで選ばれているコスメが分かります。",
  },
  {
    slug: "petit-price",
    en: "Petit",
    name: "プチプラ・ドラコス",
    keywords: ["プチプラ", "ドラコス", "ドラッグストア", "100均", "ダイソー"],
    lead: "プチプラ・ドラッグストア・100均をテーマにした動画で紹介されたコスメを集めました。手に取りやすい価格帯で、複数の人が紹介しているものだけを載せています。",
  },
  // 178章で追加（ユーザー判断）。どれも3チャンネル以上が紹介した商品が20品以上ある軸
  {
    slug: "new-release",
    en: "New",
    publishFrom: "2026-10-21",
    recentDays: 365,
    name: "新作コスメ",
    keywords: ["新作"],
    lead: "「新作」をテーマにした動画で紹介されたコスメを集めました。発売に合わせて複数のインフルエンサーが試したものだけを載せています。",
  },
  {
    slug: "best-cosme",
    en: "Best",
    publishFrom: "2026-12-02",
    recentDays: 365,
    name: "ベスコス",
    keywords: ["ベスコス", "ベストコスメ"],
    lead: "インフルエンサーが自分のベストコスメを選ぶ「ベスコス」動画から集めました。1年使ってみて選ばれたコスメが分かります。",
  },
  {
    slug: "skincare",
    en: "Skin",
    publishFrom: "2026-10-07",
    name: "スキンケア",
    keywords: ["スキンケア"],
    lead: "スキンケアをテーマにした動画で紹介されたアイテムを集めました。化粧水・美容液・クリームなど、複数の人が使っているものだけを載せています。",
    groups: ["スキンケア"],
    perGroup: 15,
  },
  {
    slug: "korean-cosme",
    en: "Korea",
    publishFrom: "2026-11-04",
    name: "韓国コスメ",
    keywords: ["韓国", "Qoo10", "オリヤン", "オリーブヤング"],
    lead: "韓国コスメ・Qoo10・オリーブヤングをテーマにした動画で紹介されたコスメを集めました。",
  },
  {
    slug: "favorites",
    en: "Repeat",
    publishFrom: "2026-11-18",
    name: "愛用品・リピート",
    keywords: ["愛用", "リピ"],
    lead: "「愛用品」「リピート買い」をテーマにした動画で紹介されたコスメを集めました。使い続けられているものが分かります。",
  },
];
/** 掲載する条件: 紹介したチャンネル数がこれ以上（1人が何本も紹介しただけの商品を除く） */
export const FEATURE_MIN_CHANNELS = 3;
export const FEATURE_PER_GROUP = 5;
/** 載せる商品がこれ未満の特集は、公開日を過ぎても出さない（中身の薄いページを作らない） */
export const FEATURE_MIN_ITEMS = 15;

/** ビルド時点（JST）の日付 YYYY-MM-DD */
function todayJst(): string {
  // 予約した特集の確認用：FEATURE_PREVIEW_DATE=YYYY-MM-DD npm run build でその日の見え方を組める
  if (process.env.FEATURE_PREVIEW_DATE) return process.env.FEATURE_PREVIEW_DATE;
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}
/** 公開してよい特集（公開日を過ぎ、商品が FEATURE_MIN_ITEMS 品以上）。ページ・一覧・サイトマップ・ホームはすべてこれを使う */
export function getPublishedFeatures(): FeatureDef[] {
  const today = todayJst();
  return FEATURES.filter((d) => {
    if (d.publishFrom && d.publishFrom > today) return false;
    const f = getFeature(d.slug)!;
    return f.groups.reduce((n, g) => n + g.items.length, 0) >= FEATURE_MIN_ITEMS;
  });
}

export interface FeatureItem {
  brand_id: string;
  brand: string;
  name_id: string;
  name: string;
  videoCount: number;
  channelCount: number;
  tag: string;
}
const _featureCache = new Map<string, ReturnType<typeof buildFeature>>();
function buildFeature(def: FeatureDef) {
  const since = def.recentDays ? Date.now() - def.recentDays * 86_400_000 : 0;
  const videos = getVisibleVideos().filter(
    (v) => def.keywords.some((k) => (v.title || "").includes(k)) && (!since || (!!v.published_at && new Date(v.published_at).getTime() >= since))
  );
  const map = new Map<string, FeatureItem & { vs: Set<string>; cs: Set<string>; views: number }>();
  for (const v of videos) {
    for (const c of v.cosmetics || []) {
      if (!c.brand_id || !c.name_id || !c.related_tags?.length) continue;
      if (isPrMention(v.key, c.brand_id, c.name_id)) continue;
      const tag = c.related_tags.map(rankingTag).find((t) => CATEGORY_TAG_TO_GROUP[t]);
      if (!tag) continue; // 大分類に属さないカテゴリ（その他）は載せない
      const key = `${c.brand_id}_${c.name_id}`;
      let e = map.get(key);
      if (!e) {
        e = { brand_id: c.brand_id, brand: c.brand, name_id: c.name_id, name: c.name, tag, videoCount: 0, channelCount: 0, vs: new Set(), cs: new Set(), views: 0 };
        map.set(key, e);
      }
      if (!e.vs.has(v.key)) {
        e.vs.add(v.key);
        e.cs.add(v.channel_id);
        e.views += toNumber(v.view_count);
      }
    }
  }
  const items = Array.from(map.values())
    .map((e) => ({ ...e, videoCount: e.vs.size, channelCount: e.cs.size }))
    .filter((e) => e.channelCount >= FEATURE_MIN_CHANNELS)
    .sort((a, b) => b.channelCount - a.channelCount || b.videoCount - a.videoCount || b.views - a.views || a.name.localeCompare(b.name, "ja"));
  const groups = RANKING_CATEGORY_GROUPS.filter((g) => !def.groups || def.groups.includes(g.group)).map((g) => ({
    group: g.group,
    items: items.filter((e) => CATEGORY_TAG_TO_GROUP[e.tag] === g.group).slice(0, def.perGroup ?? FEATURE_PER_GROUP),
  })).filter((g) => g.items.length > 0);
  const sample = [...videos].sort((a, b) => toNumber(b.view_count) - toNumber(a.view_count)).slice(0, 6);
  return {
    def,
    videoCount: videos.length,
    channelCount: new Set(videos.map((v) => v.channel_id)).size,
    groups,
    sample,
    newest: sortByPublishedDesc(videos)[0]?.published_at,
  };
}
export function getFeature(slug: string) {
  const def = FEATURES.find((f) => f.slug === slug);
  if (!def) return undefined;
  if (!_featureCache.has(slug)) _featureCache.set(slug, buildFeature(def));
  return _featureCache.get(slug)!;
}
/** 特集の表紙に並べる画像（ホームの特集カード・特集一覧）。各カテゴリの1位を先に、足りなければ2位以下から（大分類が1つの特集でも並ぶように） */
export function featureCoverImages(slug: string, n = 3): { src: string; alt: string }[] {
  const f = getFeature(slug);
  if (!f) return [];
  const depth = Math.max(0, ...f.groups.map((g) => g.items.length));
  const ordered: FeatureItem[] = [];
  for (let i = 0; i < depth; i++) for (const g of f.groups) if (g.items[i]) ordered.push(g.items[i]);
  const out: { src: string; alt: string }[] = [];
  for (const it of ordered) {
    const src = productImageSrc(getCosmeticListEntry(it.brand_id, it.name_id));
    if (src && !out.some((o) => o.src === src)) out.push({ src, alt: `${it.brand} ${it.name}` });
    if (out.length >= n) break;
  }
  return out;
}

/** 肌悩みから探す（/concern/<slug>/。228章）。商品ごとの言及（字幕の発言の要約）に悩みの語がある紹介だけを数える。
 * AIの推測（skin_profile・skin_concern）は使わず、インフルエンサーが実際に言ったことを根拠にする（68章の方針）。
 * 「乾燥肌には向かない」のような悪い評価は数えない。特集と違い、悩みごとのページは一度に出す（ユーザー判断、228章）。 */
export interface ConcernDef {
  slug: string;
  name: string;
  /** 一覧の表紙に大きく敷く英語名（CoverArt） */
  en: string;
  /** 言及の文（読点・句点で区切った1節）にこれが含まれれば、その悩みの紹介とみなす */
  pattern: RegExp;
  lead: string;
}
export const CONCERNS: ConcernDef[] = [
  { slug: "pores", en: "Pores", name: "毛穴", pattern: /毛穴/, lead: "毛穴を隠したい・目立たなくしたいときに、インフルエンサーが使っているコスメです。下地・パウダーから洗顔・スキンケアまで、「毛穴」に触れて紹介されたものを集めました。" },
  { slug: "dryness", en: "Dry", name: "乾燥", pattern: /乾燥|カサカサ|粉吹/, lead: "乾燥肌・乾燥する季節に、インフルエンサーが使っているコスメです。「乾燥しない」「乾燥肌でも使える」と紹介されたものを集めました。" },
  { slug: "oil", en: "Shine", name: "テカリ・化粧崩れ", pattern: /テカ|皮脂|崩れにく|崩れ防止|化粧崩れ/, lead: "テカリや化粧崩れを防ぎたいときに、インフルエンサーが使っているコスメです。「崩れにくい」「皮脂を抑える」と紹介されたものを集めました。" },
  { slug: "spots", en: "Spots", name: "シミ・そばかす", pattern: /シミ|そばかす|色素沈着|美白/, lead: "シミ・そばかすをカバーしたり、美白ケアをしたりするときに、インフルエンサーが使っているコスメです。" },
  { slug: "redness", en: "Red", name: "赤み", pattern: /赤み|赤ら/, lead: "頬や小鼻の赤みを抑えたいときに、インフルエンサーが使っているコスメです。コントロールカラー・コンシーラー・鎮静ケアなどを集めました。" },
  { slug: "dullness", en: "Dull", name: "くすみ", pattern: /くすみ|くすん/, lead: "肌のくすみを飛ばしたいときに、インフルエンサーが使っているコスメです。トーンアップ下地・ブライトニングケアなどを集めました。" },
  { slug: "dark-circles", en: "Dark", name: "クマ", pattern: /クマ/, lead: "目の下のクマを隠したいときに、インフルエンサーが使っているコスメです。コンシーラー・カラー下地などを集めました。" },
  { slug: "wrinkles", en: "Lines", name: "シワ・たるみ", pattern: /シワ|しわ|たるみ|エイジング/, lead: "シワ・たるみなどのエイジングケアで、インフルエンサーが使っているコスメです。" },
  { slug: "acne", en: "Acne", name: "ニキビ・肌荒れ", pattern: /ニキビ|にきび|肌荒れ|吹き出物/, lead: "ニキビ・肌荒れのときや、ニキビ跡を隠したいときに、インフルエンサーが使っているコスメです。" },
  { slug: "sensitive", en: "Calm", name: "敏感肌", pattern: /敏感|低刺激/, lead: "敏感肌・肌がゆらぐときに、インフルエンサーが使っているコスメです。「低刺激」「敏感肌でも使える」と紹介されたものを集めました。" },
];
/** 悪い評価の言い方。HARD があれば数えない。SOFT は「〜な方におすすめ」のような良い言い方（POS）が同じ節に無いときだけ数えない */
const CONCERN_NEG_HARD = /向かな|合わな|注意|悪化|イマイチ|微妙|残念|カサつ[いく]た/;
const CONCERN_NEG_SOFT = /かも|苦手|意見|目立つ(?!方|人)|しやすい$|荒れた|ができ|乾燥する感じ|乾燥を感じ(?!な)|しみ[たる]|ヒリヒリ|ピリ/;
const CONCERN_POS = /おすすめ|ぜひ|ぴったり|いい|良い|方に|人に|さんに|でも|ない|ず$|にく|づら/;
/** 言及から、その悩みに触れている節（悪い評価を除く）をすべて返す */
function concernClauses(mentions: string[] | undefined, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const m of mentions || []) {
    for (const cl of m.split(/[。、,，]/)) {
      const t = cl.trim();
      if (!t || !pattern.test(t)) continue;
      if (CONCERN_NEG_HARD.test(t)) continue;
      if (CONCERN_NEG_SOFT.test(t) && !CONCERN_POS.test(t.replace(CONCERN_NEG_SOFT, ""))) continue;
      out.push(t);
    }
  }
  return out;
}
/** その悩みに触れている最初の節（数える・数えないの判定に使う） */
function concernClause(mentions: string[] | undefined, pattern: RegExp): string | undefined {
  return concernClauses(mentions, pattern)[0];
}
/** 効能を言い切る言い方。悩み・成分のページは広告と見なされうるので、発言の引用でもこれを含むものは出さない
 * （薬機法：一般化粧品が言える効能は56項目だけ。体験談でも効能の保証に見える使い方は不可。ユーザー判断、253章）。
 * 数える・数えないの判定には使わない（引用として出すかどうかだけ） */
export const EFFICACY_RE = /効[くかきけい]|効果|改善|治[らりるれろっしす]|治療|消え|消す|消し|なく(?:な|し)|無く(?:な|し)|薄く(?:な|し)|減[らりるれっ]|小さくな|引き締|リフトアップ|若返|再生|即効|根本|完治/;
/** 引用に出してよい節（効能を言い切らないもの）。無ければ undefined */
function quotableClause(mentions: string[] | undefined, pattern: RegExp): string | undefined {
  return concernClauses(mentions, pattern).find((t) => !EFFICACY_RE.test(t));
}
export const CONCERN_PER_GROUP = 10;
export interface ConcernItem extends FeatureItem {
  /** 根拠の発言（再生回数の多い動画のもの） */
  /** 根拠の発言（効能を言い切る発言しか無い商品は無し） */
  quote?: string;
  quoteChannel?: string;
}
const _concernCache = new Map<string, ReturnType<typeof buildConcern>>();
function buildConcern(def: ConcernDef) {
  const map = new Map<string, ConcernItem & { vs: Set<string>; cs: Set<string>; views: number; qv: number }>();
  const videoKeys = new Set<string>();
  const channels = new Set<string>();
  for (const v of getVisibleVideos()) {
    for (const c of v.cosmetics || []) {
      if (!c.brand_id || !c.name_id || !c.related_tags?.length) continue;
      if (isPrMention(v.key, c.brand_id, c.name_id)) continue;
      const tag = c.related_tags.map(rankingTag).find((t) => CATEGORY_TAG_TO_GROUP[t]);
      if (!tag) continue;
      if (!concernClause(c.mentions, def.pattern)) continue;
      const quote = quotableClause(c.mentions, def.pattern);
      const key = `${c.brand_id}_${c.name_id}`;
      let e = map.get(key);
      if (!e) {
        e = { brand_id: c.brand_id, brand: c.brand, name_id: c.name_id, name: c.name, tag, videoCount: 0, channelCount: 0, vs: new Set(), cs: new Set(), views: 0, quote: undefined, quoteChannel: undefined, qv: -1 };
        map.set(key, e);
      }
      if (e.vs.has(v.key)) continue;
      const views = toNumber(v.view_count);
      e.vs.add(v.key);
      e.cs.add(v.channel_id);
      e.views += views;
      if (quote && views > e.qv) Object.assign(e, { quote, quoteChannel: v.channel_title, qv: views });
      videoKeys.add(v.key);
      channels.add(v.channel_id);
    }
  }
  const items = Array.from(map.values())
    .map((e) => ({ ...e, videoCount: e.vs.size, channelCount: e.cs.size }))
    .filter((e) => e.channelCount >= FEATURE_MIN_CHANNELS)
    .sort((a, b) => b.channelCount - a.channelCount || b.videoCount - a.videoCount || b.views - a.views || a.name.localeCompare(b.name, "ja"));
  const groups = RANKING_CATEGORY_GROUPS.map((g) => ({
    group: g.group,
    items: items.filter((e) => CATEGORY_TAG_TO_GROUP[e.tag] === g.group).slice(0, CONCERN_PER_GROUP),
  })).filter((g) => g.items.length > 0);
  return { def, videoCount: videoKeys.size, channelCount: channels.size, itemCount: items.length, groups, items };
}
export function getConcern(slug: string) {
  const def = CONCERNS.find((d) => d.slug === slug);
  if (!def) return undefined;
  if (!_concernCache.has(slug)) _concernCache.set(slug, buildConcern(def));
  return _concernCache.get(slug)!;
}
/** 公開する悩み（載せる商品が FEATURE_MIN_ITEMS 品以上）。ページ・入口・サイトマップはすべてこれを使う */
export function getPublishedConcerns(): ConcernDef[] {
  return CONCERNS.filter((d) => {
    const c = getConcern(d.slug)!;
    return c.groups.reduce((n, g) => n + g.items.length, 0) >= FEATURE_MIN_ITEMS;
  });
}
/** 悩みの入口に並べる画像（各カテゴリの1位から） */
export function concernCoverImages(slug: string, n = 3): { src: string; alt: string }[] {
  const c = getConcern(slug);
  if (!c) return [];
  const depth = Math.max(0, ...c.groups.map((g) => g.items.length));
  const out: { src: string; alt: string }[] = [];
  for (let i = 0; i < depth && out.length < n; i++) {
    for (const g of c.groups) {
      const it = g.items[i];
      if (!it) continue;
      const src = productImageSrc(getCosmeticListEntry(it.brand_id, it.name_id));
      if (src && !out.some((o) => o.src === src)) out.push({ src, alt: `${it.brand} ${it.name}` });
      if (out.length >= n) break;
    }
  }
  return out;
}

/** 成分から探す（/ingredient/<slug>/。242〜246章）。各ブランドの公式サイト（無ければ楽天市場のメーカー公式ショップ）に
 * 掲載された全成分に、その成分の表示名がある商品を載せる（言及の有無は条件にしない）。並びは、その成分に触れた言及がある商品を先にし、
 * 次に紹介したチャンネル数の順。全成分は backend/scripts/ingredients/ で原文と見比べて採用したもの、表示名の対応は ingredient_map.py。
 * 薬機法に配慮し、成分の効果・効能の説明は書かない（根拠はインフルエンサーの発言と全成分の事実だけ。239章） */
export interface IngredientDef {
  slug: string;
  name: string;
  en: string;
  /** 言及（字幕の発言の要約）でその成分に触れているとみなす語（build_targets.py の INGREDIENT_WORDS と同じ） */
  pattern: RegExp;
}
export const INGREDIENTS: IngredientDef[] = [
  { slug: "vitamin-c", name: "ビタミンC", en: "Vitamin C", pattern: /ビタミンC|ビタC|ＶＣ|\bVC\b|アスコルビ/ },
  { slug: "ceramide", name: "セラミド", en: "Ceramide", pattern: /セラミド/ },
  { slug: "niacinamide", name: "ナイアシンアミド", en: "Niacinamide", pattern: /ナイアシンアミド/ },
  { slug: "retinol", name: "レチノール", en: "Retinol", pattern: /レチノ|レチナ/ },
  { slug: "tranexamic-acid", name: "トラネキサム酸", en: "Tranexamic", pattern: /トラネキサム/ },
  { slug: "hyaluronic-acid", name: "ヒアルロン酸", en: "Hyaluronic", pattern: /ヒアルロン/ },
  { slug: "pdrn", name: "PDRN", en: "PDRN", pattern: /PDRN|ＰＤＲＮ/ },
  { slug: "cica", name: "シカ（ツボクサエキス）", en: "Cica", pattern: /シカ|CICA|ツボクサ/ },
  { slug: "glycyrrhizic-acid", name: "グリチルリチン酸", en: "Glycyrrhizic", pattern: /グリチルリチン/ },
  { slug: "azelaic-acid", name: "アゼライン酸", en: "Azelaic", pattern: /アゼライン/ },
  { slug: "peptide", name: "ペプチド", en: "Peptide", pattern: /ペプチド/ },
  { slug: "acids", name: "AHA・BHA", en: "Acids", pattern: /AHA|BHA|PHA|LHA|サリチル酸|グリコール酸/ },
];
/** 掲載する条件：紹介したチャンネル数がこれ以上（全成分を集めた対象と同じ。242章） */
export const INGREDIENT_MIN_CHANNELS = 2;
/** 載せる商品がこれ未満の成分は、ページを出さない */
export const INGREDIENT_MIN_ITEMS = 5;
/** 区分ごとに載せる品数の上限 */
export const INGREDIENT_PER_SECTION = 15;
/** 成分のページの区分（スキンケアは大分類が1つなので、使う順に細かく分ける） */
export const INGREDIENT_SECTIONS: { name: string; tags: string[] }[] = [
  { name: "クレンジング・洗顔", tags: ["オイルクレンジング", "クレンジングバーム", "クレンジングジェル", "クレンジングクリーム", "ミルククレンジング", "リキッドクレンジング", "その他クレンジング", "洗顔ジェル", "泡洗顔", "洗顔フォーム", "洗顔石鹸", "洗顔パウダー", "その他洗顔料", "ゴマージュ・ピーリング", "ポイントメイクリムーバー"] },
  { name: "化粧水・導入液", tags: ["ブースター・導入液", "化粧水", "ミスト状化粧水", "トナーパッド"] },
  { name: "美容液・パック", tags: ["美容液", "シートマスク・パック", "洗い流すパック・マスク", "アイケア・アイクリーム"] },
  { name: "乳液・クリーム", tags: ["乳液", "フェイスクリーム", "乳液・クリーム", "オールインワン化粧品", "フェイスオイル・バーム", "ネック・デコルテケア"] },
  { name: "日焼け止め・下地", tags: ["日焼け止め・UVケア(顔用)", "日焼け止めクリーム", "化粧下地", "BB・CCクリーム", "クッションファンデ", "リキッドファンデーション", "クリーム・ジェルファンデーション", "コンシーラー", "プレストパウダー", "ルースパウダー"] },
];
const INGREDIENT_SECTION_OF: Record<string, string> = Object.fromEntries(INGREDIENT_SECTIONS.flatMap((g) => g.tags.map((t) => [t, g.name])));
const SECTION_OTHER = "その他";

export interface IngredientInfo {
  source: "official" | "rakuten";
  url: string;
  shop?: string;
  active: string[];
  items: string[];
}
const ingredientProducts = (ingredientsData as { products: Record<string, IngredientInfo> }).products;
const ingredientLabels = (ingredientsData as { labels: Record<string, Record<string, string[]>> }).labels;
/** 商品の全成分（出典つき）。集めていない商品は undefined */
export function getIngredientInfo(brand_id: string, name_id: string): IngredientInfo | undefined {
  return ingredientProducts[`${brand_id}_${name_id}`];
}
/** 商品の全成分に当たった成分（成分のページがあるものだけ） */
export function getIngredientsOfCosmetic(brand_id: string, name_id: string): { def: IngredientDef; labels: string[] }[] {
  const hit = ingredientLabels[`${brand_id}_${name_id}`] || {};
  const published = new Set(getPublishedIngredients().map((d) => d.slug));
  return INGREDIENTS.filter((d) => hit[d.slug] && published.has(d.slug)).map((d) => ({ def: d, labels: hit[d.slug] }));
}
export interface IngredientItem extends FeatureItem {
  /** その成分に触れた発言（再生回数の多い動画のもの）。無ければ空 */
  quote?: string;
  quoteChannel?: string;
  /** その成分に触れた言及があるか（引用を出さない商品も含む。並び順に使う） */
  mentioned: boolean;
  /** 全成分で当たった表示名 */
  labels: string[];
  /** 当たった表示名のうち、医薬部外品の有効成分 */
  active: string[];
  info: IngredientInfo;
}
const _ingredientCache = new Map<string, ReturnType<typeof buildIngredient>>();
function buildIngredient(def: IngredientDef) {
  const map = new Map<string, IngredientItem & { vs: Set<string>; cs: Set<string>; views: number; qv: number }>();
  for (const v of getVisibleVideos()) {
    for (const c of v.cosmetics || []) {
      if (!c.brand_id || !c.name_id) continue;
      const key = `${c.brand_id}_${c.name_id}`;
      const labels = ingredientLabels[key]?.[def.slug];
      if (!labels) continue;
      if (isPrMention(v.key, c.brand_id, c.name_id)) continue;
      const info = ingredientProducts[key];
      const tag = (c.related_tags || []).map(rankingTag).find((t) => CATEGORY_TAG_TO_GROUP[t]) || "";
      let e = map.get(key);
      if (!e) {
        e = { brand_id: c.brand_id, brand: c.brand, name_id: c.name_id, name: c.name, tag, videoCount: 0, channelCount: 0, vs: new Set(), cs: new Set(), views: 0, qv: -1, mentioned: false,
          labels, active: labels.filter((x) => info.active.includes(x)), info };
        map.set(key, e);
      }
      if (e.vs.has(v.key)) continue;
      const views = toNumber(v.view_count);
      e.vs.add(v.key);
      e.cs.add(v.channel_id);
      e.views += views;
      if (concernClause(c.mentions, def.pattern)) e.mentioned = true;
      const quote = quotableClause(c.mentions, def.pattern);
      if (quote && views > e.qv) Object.assign(e, { quote, quoteChannel: v.channel_title, qv: views });
    }
  }
  const all = Array.from(map.values())
    .map((e) => ({ ...e, videoCount: e.vs.size, channelCount: e.cs.size }))
    .filter((e) => e.channelCount >= INGREDIENT_MIN_CHANNELS)
    .sort((a, b) => Number(b.mentioned) - Number(a.mentioned) || b.channelCount - a.channelCount || b.videoCount - a.videoCount || b.views - a.views || a.name.localeCompare(b.name, "ja"));
  const sectionOf = (e: IngredientItem) => INGREDIENT_SECTION_OF[e.tag] || SECTION_OTHER;
  const sections = [...INGREDIENT_SECTIONS.map((g) => g.name), SECTION_OTHER]
    .map((name) => {
      const list = all.filter((e) => sectionOf(e) === name);
      return { name, items: list.slice(0, INGREDIENT_PER_SECTION), rest: Math.max(0, list.length - INGREDIENT_PER_SECTION) };
    })
    .filter((g) => g.items.length > 0);
  // ページに出す表示名の一覧（多い順）
  const labelCount = new Map<string, number>();
  // 配合率などの末尾の括弧書き（「(2.0%)」「(20,000ppm)」）は外して数える
  const plain = (x: string) => x.normalize("NFKC").replace(/\s*\([^()]*\)\s*$/, "").trim();
  for (const e of all) for (const l of new Set(e.labels.map(plain))) labelCount.set(l, (labelCount.get(l) || 0) + 1);
  const labels = Array.from(labelCount.entries()).sort((a, b) => b[1] - a[1]).map(([l]) => l);
  return {
    def,
    all,
    itemCount: all.length,
    quotedCount: all.filter((e) => e.mentioned).length,
    channelCount: new Set(all.flatMap((e) => [...e.cs])).size,
    officialCount: all.filter((e) => e.info.source === "official").length,
    labels,
    sections,
  };
}
export function getIngredient(slug: string) {
  const def = INGREDIENTS.find((d) => d.slug === slug);
  if (!def) return undefined;
  if (!_ingredientCache.has(slug)) _ingredientCache.set(slug, buildIngredient(def));
  return _ingredientCache.get(slug)!;
}
/** 公開する成分（載せる商品が INGREDIENT_MIN_ITEMS 品以上）。ページ・入口・サイトマップはすべてこれを使う */
export function getPublishedIngredients(): IngredientDef[] {
  return INGREDIENTS.filter((d) => getIngredient(d.slug)!.itemCount >= INGREDIENT_MIN_ITEMS);
}
/** 成分の入口に並べる画像（各区分の1位から） */
export function ingredientCoverImages(slug: string, n = 3): { src: string; alt: string }[] {
  const g = getIngredient(slug);
  if (!g) return [];
  const out: { src: string; alt: string }[] = [];
  const depth = Math.max(0, ...g.sections.map((s) => s.items.length));
  for (let i = 0; i < depth && out.length < n; i++) {
    for (const s of g.sections) {
      const it = s.items[i];
      if (!it) continue;
      const src = productImageSrc(getCosmeticListEntry(it.brand_id, it.name_id));
      if (src && !out.some((o) => o.src === src)) out.push({ src, alt: `${it.brand} ${it.name}` });
      if (out.length >= n) break;
    }
  }
  return out;
}
/** 肌悩み×成分（/concern/<悩み>/<成分>/。5-2、253章）。組は運営者が決めず、同じ言及（1つの発言の要約）に悩みの語
 * （悪い評価を除く。concernClause）と成分の語が両方ある紹介の数で決める。ページに載せるのは、成分のページに載る商品
 * （全成分にその成分がある・2チャンネル以上）のうち、その悩みに触れて紹介されたもの。一緒に語られた商品を先に出す。
 * 成分が悩みに効くとは書かない（薬機法。239章）。「一緒に語られた」という事実と、発言・全成分だけを示す */
export const CONCERN_INGREDIENT_MIN_MENTIONS = 5;
interface CIProduct { quote?: string; quoteChannel?: string; qv: number; pair: boolean; /** 引用が一緒に語られた発言か */ qPair: boolean }
interface CIPair { mentions: Set<string>; prods: Map<string, CIProduct> }
let _ciIndex: Map<string, CIPair> | null = null;
function concernIngredientIndex(): Map<string, CIPair> {
  if (_ciIndex) return _ciIndex;
  const idx = new Map<string, CIPair>();
  for (const v of getVisibleVideos()) {
    const views = toNumber(v.view_count);
    for (const c of v.cosmetics || []) {
      if (!c.brand_id || !c.name_id || !c.mentions?.length) continue;
      if (isPrMention(v.key, c.brand_id, c.name_id)) continue;
      const key = `${c.brand_id}_${c.name_id}`;
      for (const cd of CONCERNS) {
        const clause = concernClause(c.mentions, cd.pattern);
        if (!clause) continue;
        for (const ing of INGREDIENTS) {
          const pairMention = c.mentions.find((m) => ing.pattern.test(m) && concernClause([m], cd.pattern));
          const hasLabels = !!ingredientLabels[key]?.[ing.slug];
          if (!pairMention && !hasLabels) continue;
          const pk = `${cd.slug}|${ing.slug}`;
          let p = idx.get(pk);
          if (!p) idx.set(pk, (p = { mentions: new Set(), prods: new Map() }));
          if (pairMention) p.mentions.add(`${v.key}|${key}`);
          if (!hasLabels) continue;
          // 引用は効能を言い切らないものだけ。一緒に語られた発言（全体）→悩みに触れた節の順に探す
          const safePair = c.mentions.find((m) => ing.pattern.test(m) && concernClause([m], cd.pattern) && !EFFICACY_RE.test(m));
          const quote = safePair?.trim() || quotableClause(c.mentions, cd.pattern);
          const qPair = !!safePair;
          const e = p.prods.get(key);
          const pair = !!pairMention || !!e?.pair;
          if (!e) p.prods.set(key, { quote, quoteChannel: quote ? v.channel_title : undefined, qv: quote ? views : -1, pair, qPair });
          else {
            e.pair = pair;
            // 一緒に語られた発言を、悩みだけの発言より優先する。同じ種類なら再生回数の多い動画のもの
            if (quote && (!e.quote || (qPair && !e.qPair) || (qPair === e.qPair && views > e.qv))) Object.assign(e, { quote, quoteChannel: v.channel_title, qv: views, qPair });
          }
        }
      }
    }
  }
  return (_ciIndex = idx);
}
export interface ConcernIngredientItem extends IngredientItem {
  /** 悩みと成分が同じ発言で語られた商品か */
  pair: boolean;
}
const _ciCache = new Map<string, ReturnType<typeof buildConcernIngredient>>();
function buildConcernIngredient(cd: ConcernDef, ing: IngredientDef) {
  const p = concernIngredientIndex().get(`${cd.slug}|${ing.slug}`);
  const g = getIngredient(ing.slug)!;
  const all: ConcernIngredientItem[] = g.all
    .filter((e) => p?.prods.has(`${e.brand_id}_${e.name_id}`))
    .map((e) => {
      const q = p!.prods.get(`${e.brand_id}_${e.name_id}`)!;
      return { ...e, quote: q.quote, quoteChannel: q.quote ? q.quoteChannel : undefined, pair: q.pair };
    })
    .sort((a, b) => Number(b.pair) - Number(a.pair) || b.channelCount - a.channelCount || b.videoCount - a.videoCount || a.name.localeCompare(b.name, "ja"));
  const sectionOf = (e: IngredientItem) => INGREDIENT_SECTION_OF[e.tag] || SECTION_OTHER;
  const sections = [...INGREDIENT_SECTIONS.map((x) => x.name), SECTION_OTHER]
    .map((name) => {
      const list = all.filter((e) => sectionOf(e) === name);
      return { name, items: list.slice(0, INGREDIENT_PER_SECTION), rest: Math.max(0, list.length - INGREDIENT_PER_SECTION) };
    })
    .filter((x) => x.items.length > 0);
  return { concern: cd, ingredient: ing, mentionCount: p?.mentions.size || 0, itemCount: all.length, pairCount: all.filter((e) => e.pair).length, sections };
}
export function getConcernIngredient(concernSlug: string, ingredientSlug: string) {
  const cd = CONCERNS.find((d) => d.slug === concernSlug);
  const ing = INGREDIENTS.find((d) => d.slug === ingredientSlug);
  if (!cd || !ing) return undefined;
  const k = `${concernSlug}|${ingredientSlug}`;
  if (!_ciCache.has(k)) _ciCache.set(k, buildConcernIngredient(cd, ing));
  return _ciCache.get(k)!;
}
/** 公開する肌悩み×成分（一緒に語られた紹介が CONCERN_INGREDIENT_MIN_MENTIONS 件以上で、載せる商品が INGREDIENT_MIN_ITEMS 品以上）。
 * 一緒に語られた数の多い順。ページ・悩みと成分のページの帯・サイトマップはすべてこれを使う */
let _ciPublished: ReturnType<typeof getConcernIngredient>[] | null = null;
export function getPublishedConcernIngredients() {
  if (_ciPublished) return _ciPublished;
  const concerns = getPublishedConcerns();
  const ings = getPublishedIngredients();
  const out = concerns
    .flatMap((cd) => ings.map((ing) => getConcernIngredient(cd.slug, ing.slug)!))
    .filter((x) => x.mentionCount >= CONCERN_INGREDIENT_MIN_MENTIONS && x.itemCount >= INGREDIENT_MIN_ITEMS)
    .sort((a, b) => b.mentionCount - a.mentionCount);
  return (_ciPublished = out);
}

/** 全成分の出典の表示名（例：「公式サイト」「楽天市場 ◯◯公式ショップ」） */
export function ingredientSourceLabel(info: IngredientInfo): string {
  return info.source === "official" ? "公式サイト" : `楽天市場 ${info.shop || "メーカー公式ショップ"}`;
}

/** 検索欄から入る「探し方」のページ（肌悩み・成分・特集・カテゴリのランキング。247章）。
 * 上のメニューは4項目に絞り、これらは検索欄の入口（何も入力せずに触れたときのパネル）と、入力したときの候補から入る */
export interface ExploreEntry {
  kind: "肌悩み" | "成分" | "特集" | "ランキング";
  label: string;
  path: string;
  /** 候補で引ける語（名前と、言及の語の別名） */
  words: string[];
  count: number;
}
/** 言及の語の正規表現（/シミ|そばかす|色素沈着/）から、候補で引ける語を取り出す */
function patternWords(re: RegExp): string[] {
  return re.source
    .replace(/\\b|\(\?[!=<][^)]*\)/g, "")
    .split("|")
    .map((w) => w.replace(/[\\^$()[\]?*+.{}]/g, ""))
    .filter((w) => w.length >= 2);
}
let _exploreCache: ExploreEntry[] | undefined;
export function getExploreEntries(): ExploreEntry[] {
  if (_exploreCache) return _exploreCache;
  const out: ExploreEntry[] = [];
  for (const d of getPublishedConcerns()) {
    const c = getConcern(d.slug)!;
    // 「乾燥肌」「敏感肌」のように「肌」を付けた言い方でも引けるようにする
    const ws = [d.name, ...patternWords(d.pattern)];
    out.push({ kind: "肌悩み", label: d.name, path: `/concern/${d.slug}/`, words: [...ws, ...ws.filter((w) => !w.endsWith("肌")).map((w) => `${w}肌`)], count: c.itemCount });
  }
  for (const d of getPublishedIngredients()) {
    out.push({ kind: "成分", label: d.name, path: `/ingredient/${d.slug}/`, words: [d.name, d.en, ...patternWords(d.pattern)], count: getIngredient(d.slug)!.itemCount });
  }
  for (const d of getPublishedFeatures()) {
    const f = getFeature(d.slug)!;
    out.push({ kind: "特集", label: d.name, path: `/feature/${d.slug}/`, words: [d.name, ...d.keywords], count: f.groups.reduce((n, g) => n + g.items.length, 0) });
  }
  for (const [tag, page] of getRankingPages()) {
    out.push({ kind: "ランキング", label: tag, path: `/ranking/${encodeURIComponent(tag)}/`, words: [tag, ...tag.split(/[・()（）]/)].filter((w) => w.length >= 2), count: page.list.length });
  }
  // 引ける語は空白で区切って渡すので、語の中の空白（「Vitamin C」）は詰め、重複を除く
  for (const e of out) e.words = [...new Set(e.words.map((w) => w.replace(/\s+/g, "")))];
  _exploreCache = out;
  return out;
}

/** ヘッダーの「探す」メニュー（パソコンは上から降りてくる領域、スマホは全画面のメニュー。248章）の中身。
 * カテゴリは、ランキングの大分類ごとに、品数の多いページ（「〜全般」のまとめを含む）を MENU_CATEGORY_PER_GROUP 件ずつ */
export const MENU_CATEGORY_GROUPS = ["ベースメイク", "アイメイク", "チーク・リップ", "スキンケア", "アイブロウ", "ヘアケア"];
const MENU_CATEGORY_PER_GROUP = 4;
export interface MenuLink { label: string; path: string }
let _menuCache: { categories: { group: string; items: MenuLink[] }[]; concerns: MenuLink[]; ingredients: MenuLink[]; features: MenuLink[] } | undefined;
export function getMenuData() {
  if (_menuCache) return _menuCache;
  const nav = getRankingNav();
  const categories = MENU_CATEGORY_GROUPS.map((group) => {
    const items = (nav.find((g) => g.group === group)?.items || [])
      .slice()
      .sort((a, b) => b.count - a.count)
      .slice(0, MENU_CATEGORY_PER_GROUP)
      .map((it) => ({ label: it.name.replace(/全般$/, ""), path: `/ranking/${encodeURIComponent(it.name)}/` }));
    return { group, items };
  }).filter((g) => g.items.length > 0);
  const ex = getExploreEntries();
  const pick = (kind: ExploreEntry["kind"]) => ex.filter((e) => e.kind === kind).map((e) => ({ label: e.label, path: e.path }));
  _menuCache = { categories, concerns: pick("肌悩み"), ingredients: pick("成分"), features: pick("特集") };
  return _menuCache;
}

/** 検索欄の案内文で順に見せる例（249章）。このサイトならではの探し方（成分・人の名前・肌悩み×カテゴリ・ブランド）を、データから選ぶ */
let _searchExamples: string[] | undefined;
export function getSearchExamples(): string[] {
  if (_searchExamples) return _searchExamples;
  const ings = getPublishedIngredients().map((d) => ({ d, n: getIngredient(d.slug)!.itemCount })).sort((a, b) => b.n - a.n);
  const ing = ings.find((x) => x.d.slug === "niacinamide")?.d.name || ings[0]?.d.name;
  const person = getInfluencerRanking()[0]?.channel_title;
  const concern = getPublishedConcerns()[0]?.name.split("・")[0];
  const brand = getPopularBrands(1)[0]?.name;
  _searchExamples = [ing, person, concern && `${concern} 下地`, brand].filter((x): x is string => !!x).map((x) => `例：${x}`);
  return _searchExamples;
}

/** 一覧の表紙の画像を、前のカードで使った画像と重ならないように3枚ずつ選ぶ（228章） */
export function distinctCovers<T>(list: T[], candidates: (x: T) => { src: string; alt: string }[], n = 3): (T & { imgs: { src: string; alt: string }[] })[] {
  const used = new Set<string>();
  return list.map((x) => {
    const all = candidates(x);
    const fresh = all.filter((i) => !used.has(i.src));
    const imgs = (fresh.length >= n ? fresh : [...fresh, ...all.filter((i) => used.has(i.src))]).slice(0, n);
    imgs.forEach((i) => used.add(i.src));
    return { ...x, imgs };
  });
}

/** 商品ページの構造化データ（Product.category）用に、単一のカテゴリ名（例:「アイブロウペンシル」）を
 * 「コスメ・美容 > 大分類 > カテゴリ名」の階層テキストに変換する（Search Consoleの「category の値が無効」指摘への対応）。
 * 大分類は RANKING_CATEGORY_GROUPS と同じ区分を使う（未定義のカテゴリは「その他」）。 */
export function productCategoryPath(category: string): string {
  const group = CATEGORY_TAG_TO_GROUP[category] || "その他";
  return `コスメ・美容 > ${group} > ${category}`;
}

/** 同じ種類の細かいカテゴリを束ねる「まとめ」ランキング（例: リキッド・クリーム・パウダー等をまとめた「ファンデーション全般」）。
 * 名前は既存のカテゴリ名と重ならないようにする。細かいカテゴリのランキングも、そのまま別に見られる。
 * 商品ごとのスコアはカテゴリによらず同じなので、まとめの順位は「細かいカテゴリの商品を重複なく集めて、同じ基準で並べたもの」。 */
export interface RankingParent {
  name: string;
  group: string;
  tags: string[];
}
export const RANKING_PARENTS: RankingParent[] = [
  { name: "ファンデーション全般", group: "ベースメイク", tags: ["リキッドファンデーション", "クリーム・ジェルファンデーション", "パウダーファンデーション", "ファンデーション", "その他ファンデーション", "クッションファンデ", "BB・CCクリーム"] },
  { name: "フェイスパウダー全般", group: "ベースメイク", tags: ["プレストパウダー", "ルースパウダー"] },
  { name: "アイブロウ全般", group: "アイブロウ", tags: ["アイブロウペンシル", "パウダーアイブロウ", "眉マスカラ", "その他アイブロウ", "アイブロウ"] },
  { name: "アイシャドウ全般", group: "アイメイク", tags: ["パウダーアイシャドウ", "ジェル・クリームアイシャドウ", "アイシャドウ", "アイシャドウパレット", "アイシャドウベース"] },
  { name: "アイライナー全般", group: "アイメイク", tags: ["リキッドアイライナー", "ジェルアイライナー", "ペンシルアイライナー", "その他アイライナー"] },
  { name: "マスカラ全般", group: "アイメイク", tags: ["マスカラ", "マスカラ下地・トップコート"] },
  { name: "チーク全般", group: "チーク・リップ", tags: ["パウダーチーク", "ジェル・クリームチーク"] },
  { name: "リップ全般", group: "チーク・リップ", tags: ["口紅", "リップグロス", "リップライナー", "リップケア・リップクリーム"] },
  { name: "クレンジング全般", group: "スキンケア", tags: ["オイルクレンジング", "クレンジングバーム", "クレンジングジェル", "クレンジングクリーム", "ミルククレンジング", "リキッドクレンジング", "その他クレンジング"] },
  { name: "化粧水全般", group: "スキンケア", tags: ["化粧水", "ミスト状化粧水"] },
  { name: "乳液・クリーム全般", group: "スキンケア", tags: ["乳液", "フェイスクリーム", "乳液・クリーム"] },
];

/** ランキングのページ1つ分（細かいカテゴリ、または「まとめ」）。 */
export interface RankingPageEntry {
  /** URLとページ名に使う名前 */
  key: string;
  kind: "category" | "parent";
  /** 「まとめ」の場合、束ねている（実際にランキングのある）細かいカテゴリ */
  children: string[];
  list: CosmeticRanking[];
}

const rankingCmp = (a: CosmeticRanking, b: CosmeticRanking) =>
  b.score - a.score || b.videoCount - a.videoCount || a.name.localeCompare(b.name, "ja");

let _rankingPages: Map<string, RankingPageEntry> | null = null;
/** ランキングのページ（細かいカテゴリ＋「まとめ」）を、キー別に返す。「まとめ」は細かいカテゴリが2つ以上あるものだけ。 */
export function getRankingPages(): Map<string, RankingPageEntry> {
  if (_rankingPages) return _rankingPages;
  const byTag = getCosmeticRankingsByTag();
  const pages = new Map<string, RankingPageEntry>();
  for (const [tag, list] of byTag) pages.set(tag, { key: tag, kind: "category", children: [], list });
  for (const p of RANKING_PARENTS) {
    const present = p.tags.filter((t) => byTag.has(t));
    if (present.length < 2) continue;
    const merged = new Map<string, CosmeticRanking>();
    for (const t of present) for (const r of byTag.get(t)!) merged.set(`${r.brand_id}_${r.name_id}`, r);
    pages.set(p.name, { key: p.name, kind: "parent", children: present, list: Array.from(merged.values()).sort(rankingCmp) });
  }
  _rankingPages = pages;
  return pages;
}

/** 細かいカテゴリが属する「まとめ」（無ければundefined）。 */
export function getParentOfTag(tag: string): RankingPageEntry | undefined {
  for (const page of getRankingPages().values()) if (page.kind === "parent" && page.children.includes(tag)) return page;
  return undefined;
}

export type RankingNavItem =
  | { kind: "parent"; name: string; count: number; children: { name: string; count: number }[] }
  | { kind: "single"; name: string; count: number };

/** サイドバー・一覧用に、大分類ごとに「まとめ＋細かいカテゴリ」または単独のカテゴリを、表示順に並べる。 */
export function getRankingNav(): { group: string; items: RankingNavItem[] }[] {
  const pages = getRankingPages();
  const doneParents = new Set<string>();
  return groupTagsByCategory(getCosmeticRankingsByTag().keys()).map((g) => {
    const items: RankingNavItem[] = [];
    const done = new Set<string>();
    for (const tag of g.tags) {
      if (done.has(tag)) continue;
      const parent = getParentOfTag(tag);
      if (parent && !doneParents.has(parent.key)) {
        doneParents.add(parent.key);
        done.add(parent.key);
        const kids = parent.children.filter((c) => g.tags.includes(c));
        kids.forEach((c) => done.add(c));
        items.push({ kind: "parent", name: parent.key, count: parent.list.length, children: kids.map((c) => ({ name: c, count: pages.get(c)!.list.length })) });
      } else if (!parent) {
        done.add(tag);
        items.push({ kind: "single", name: tag, count: pages.get(tag)!.list.length });
      }
    }
    return { group: g.group, items };
  });
}

/** カテゴリ別ランキングのページURL（カテゴリ名は使えない文字を含まないため、日本語のまま使う）。 */
export function hasRankingPage(tag: string): boolean {
  return getRankingPages().has(tag);
}

export function categoryUrl(tag: string): string {
  return withBase(`/ranking/${encodeURIComponent(tag)}/`);
}

/** タグごとのスコア降順ランキング（同点は紹介動画数→名前）。 */
let _byTagCache: Map<string, CosmeticRanking[]> | null = null;
export function getCosmeticRankingsByTag(): Map<string, CosmeticRanking[]> {
  if (_byTagCache) return _byTagCache;
  const byTag = new Map<string, CosmeticRanking[]>();
  for (const r of getCosmeticRankings()) {
    for (const t of r.tags) {
      if (!byTag.has(t)) byTag.set(t, []);
      byTag.get(t)!.push(r);
    }
  }
  for (const [tag, list] of byTag) {
    if (list.length < MIN_RANKING_ITEMS) byTag.delete(tag); // 品数の少ないカテゴリはページを作らない
    else list.sort((a, b) => b.score - a.score || b.videoCount - a.videoCount || a.name.localeCompare(b.name, "ja"));
  }
  _byTagCache = byTag;
  return byTag;
}

/** 直近の動画（投稿日降順の上位 recentVideos 本）で紹介されたコスメを、その中での紹介回数順に返す。
 * 「いま動画で話題になっているコスメ」を示す。同数なら通算の人気スコア順。 */
/** 「最近話題」の集計期間（日）。投稿日がビルド時点からこの日数以内の動画だけを数える */
export const RECENT_DAYS = 90;
let _recentCache: Map<string, { videos: number; channels: number }> | null = null;
/** 商品ごとの、直近RECENT_DAYS日に投稿された動画での紹介数（動画数・チャンネル数）。キーは brand_id_name_id */
export function getRecentCounts(): Map<string, { videos: number; channels: number }> {
  if (_recentCache) return _recentCache;
  const since = Date.now() - RECENT_DAYS * 86_400_000;
  const acc = new Map<string, { vs: Set<string>; cs: Set<string> }>();
  for (const v of getVisibleVideos()) {
    if (!v.published_at || new Date(v.published_at).getTime() < since) continue;
    for (const c of v.cosmetics || []) {
      if (!c.brand_id || !c.name_id) continue;
      if (isPrMention(v.key, c.brand_id, c.name_id)) continue;
      const key = `${c.brand_id}_${c.name_id}`;
      let e = acc.get(key);
      if (!e) acc.set(key, (e = { vs: new Set(), cs: new Set() }));
      e.vs.add(v.key);
      e.cs.add(v.channel_id);
    }
  }
  _recentCache = new Map(Array.from(acc, ([k, e]) => [k, { videos: e.vs.size, channels: e.cs.size }]));
  return _recentCache;
}

/** 最近話題のコスメ：直近RECENT_DAYS日の動画で、紹介したチャンネル数→動画数→人気スコアの順 */
export function getTrendingCosmetics(limit: number): CosmeticRanking[] {
  const recent = getRecentCounts();
  return getCosmeticRankings()
    .filter((r) => recent.has(`${r.brand_id}_${r.name_id}`))
    .map((r) => ({ r, c: recent.get(`${r.brand_id}_${r.name_id}`)! }))
    .sort((a, b) => b.c.channels - a.c.channels || b.c.videos - a.c.videos || b.r.score - a.r.score)
    .slice(0, limit)
    .map((x) => x.r);
}

export interface CosmeticFacts {
  videoCount: number;
  channelCount: number;
  mainTag?: string;
  rank?: number;
  rankTotal?: number;
  /** うちPR・提供としての紹介（ランキングには数えない） */
  prCount: number;
  introductions: CosmeticIntro[];
}
export interface CosmeticIntro {
  channel_id: string;
  channel_title: string;
  channel_icon?: string;
  thumbnail?: string;
  videoKey: string;
  videoTitle: string;
  published_at: string;
  pr: boolean;
  /** 動画の再生回数（並び替え用） */
  views: number;
  /** 発信力：インフルエンサー一覧と同じスコア（getInfluencerRanking）と、その順位・5段階（influenceOf） */
  influenceScore: number;
  influenceRank: number;
  influence: number;
  /** この動画で、この商品を肌悩みに触れて紹介した節（228章） */
  concerns: { slug: string; name: string; quote: string }[];
}

/** 発信力の5段階の区切り（インフルエンサー一覧での順位の上位◯％。上位5％が5、20％までが4、40％までが3、70％までが2） */
export const INFLUENCE_TOP_SHARES = [0.05, 0.2, 0.4, 0.7];
let _influenceCache: Map<string, { score: number; rank: number; level: number; total: number }> | null = null;
/** インフルエンサー一覧と同じスコア（発信力スコア）・順位から、発信力（5段階）を返す */
export function influenceOf(channel_id: string): { score: number; rank: number; level: number; total: number } {
  if (!_influenceCache) {
    const list = getInfluencerRanking();
    const total = list.length;
    _influenceCache = new Map(
      list.map((inf, i) => {
        const share = (i + 1) / total;
        const level = 5 - INFLUENCE_TOP_SHARES.filter((s) => share > s).length;
        return [inf.channel_id, { score: inf.score, rank: i + 1, level, total }];
      })
    );
  }
  return _influenceCache.get(channel_id) || { score: 0, rank: 0, level: 0, total: _influenceCache.size };
}

let _rankingByKey: Map<string, CosmeticRanking> | null = null;
/** コスメ詳細用の事実データ。紹介した人・日付（新しい順）、主カテゴリ内での順位など。 */
export function getCosmeticFacts(brand_id: string, name_id: string): CosmeticFacts {
  const videos = sortByPublishedDesc(getVideosUsingCosmetic(brand_id, name_id));
  const introductions: CosmeticIntro[] = videos.map((v) => {
    const c = (v.cosmetics || []).find((x) => x.brand_id === brand_id && x.name_id === name_id);
    const inf = influenceOf(v.channel_id);
    return {
      channel_id: v.channel_id,
      channel_title: v.channel_title,
      channel_icon: v.channel_icon,
      thumbnail: v.thumbnail,
      videoKey: v.key,
      videoTitle: v.title,
      published_at: v.published_at,
      pr: isPrMention(v.key, brand_id, name_id),
      views: toNumber(v.view_count),
      influenceScore: inf.score,
      influenceRank: inf.rank,
      influence: inf.level,
      concerns: CONCERNS.flatMap((d) => {
        if (!concernClause(c?.mentions, d.pattern)) return [];
        return [{ slug: d.slug, name: d.name, quote: quotableClause(c?.mentions, d.pattern) || "" }];
      }),
    };
  });
  if (!_rankingByKey) _rankingByKey = new Map(getCosmeticRankings().map((x) => [`${x.brand_id}_${x.name_id}`, x]));
  const r = _rankingByKey.get(`${brand_id}_${name_id}`);
  const facts: CosmeticFacts = {
    videoCount: videos.length,
    channelCount: new Set(videos.map((v) => v.channel_id)).size,
    prCount: introductions.filter((i) => i.pr).length,
    introductions,
  };
  const byTag = getCosmeticRankingsByTag();
  const pagedTags = r ? r.tags.filter((t) => byTag.has(t)) : [];
  if (r && pagedTags.length > 0) {
    // 紹介コスメ数が最も多い（=代表的な）カテゴリで順位を出す（ランキングのページがあるカテゴリだけ）
    const mainTag = [...pagedTags].sort((a, b) => byTag.get(b)!.length - byTag.get(a)!.length)[0];
    const list = byTag.get(mainTag)!;
    facts.mainTag = mainTag;
    facts.rank = list.findIndex((x) => x.brand_id === brand_id && x.name_id === name_id) + 1;
    facts.rankTotal = list.length;
  }
  return facts;
}

// ---- コスメ詳細ページ下部の「次に見たくなる」要素 ----

export interface CosmeticTileData {
  brand_id: string;
  brand: string;
  name_id: string;
  name: string;
  imageSrc: string;
  /** 掲載動画のうち、この商品が紹介された動画の本数 */
  videoCount: number;
  /** 共起（一緒に紹介）の場合: 対象の商品と同じ動画に出た本数 */
  together?: number;
}

function cosmeticImageSrc(brand_id: string, name_id: string, fallbackHtml?: string): string {
  return productImageSrc(getCosmeticListEntry(brand_id, name_id), fallbackHtml);
}

/** 画像のある商品を先に、無いものを後ろに（元の順序は保つ）。タイルに「No Image」が並びすぎないように。 */
function imagesFirst<T extends { imageSrc: string }>(items: T[]): T[] {
  return [...items.filter((i) => i.imageSrc), ...items.filter((i) => !i.imageSrc)];
}

/** この商品を紹介した動画で、あわせて紹介されているコスメ（同じ動画に出た本数の多い順）。 */
export function getCoMentionedCosmetics(brand_id: string, name_id: string, limit = 6): CosmeticTileData[] {
  const self = `${brand_id}_${name_id}`;
  const together = new Map<string, { c: Cosmetic; n: number }>();
  for (const v of getVisibleVideos()) {
    const list = (v.cosmetics || []).filter((c) => c.brand_id && c.name_id && c.brand && c.name);
    if (!list.some((c) => `${c.brand_id}_${c.name_id}` === self)) continue;
    const seen = new Set<string>();
    for (const c of list) {
      const key = `${c.brand_id}_${c.name_id}`;
      if (key === self || seen.has(key)) continue; // 動画内の重複は1本と数える
      seen.add(key);
      const cur = together.get(key);
      if (cur) cur.n += 1;
      else together.set(key, { c, n: 1 });
    }
  }
  const total = new Map(getCosmeticRankings().map((r) => [`${r.brand_id}_${r.name_id}`, r.videoCount]));
  const items = Array.from(together.entries())
    .sort((a, b) => b[1].n - a[1].n || (total.get(b[0]) || 0) - (total.get(a[0]) || 0))
    .map(([key, { c, n }]) => ({
      brand_id: c.brand_id, brand: c.brand, name_id: c.name_id, name: c.name,
      imageSrc: cosmeticImageSrc(c.brand_id, c.name_id, c.rakuten_image_link),
      videoCount: total.get(key) || n, together: n,
    }));
  return imagesFirst(items).slice(0, limit);
}

/** カテゴリ（タグ）の人気ランキング上位。順位はランキングページと同じ並び。 */
export function getCategoryTop(tag: string, limit = 6): { rank: number; tile: CosmeticTileData }[] {
  const list = getCosmeticRankingsByTag().get(tag) || [];
  return list.slice(0, limit).map((r, i) => ({
    rank: i + 1,
    tile: {
      brand_id: r.brand_id, brand: r.brand, name_id: r.name_id, name: r.name,
      imageSrc: cosmeticImageSrc(r.brand_id, r.name_id, r.rakuten_image_link), videoCount: r.videoCount,
    },
  }));
}

/** 同じブランドの他の商品（紹介動画数などの人気順）。 */
export function getBrandTopCosmetics(brand_id: string, excludeNameId: string, limit = 6): CosmeticTileData[] {
  const items = getCosmeticRankings()
    .filter((r) => canonicalBrandId(r.brand_id) === canonicalBrandId(brand_id) && !(r.brand_id === brand_id && r.name_id === excludeNameId))
    .sort((a, b) => b.score - a.score)
    .map((r) => ({
      brand_id: r.brand_id, brand: r.brand, name_id: r.name_id, name: r.name,
      imageSrc: cosmeticImageSrc(r.brand_id, r.name_id, r.rakuten_image_link), videoCount: r.videoCount,
    }));
  return imagesFirst(items).slice(0, limit);
}

/** 投稿日を日本時間の年・月・日にする。ビルドする端末の時刻帯（手元はJST、ActionsはUTC）で変わらないよう、UTCに9時間足して読む。
 * 以前はUTCのまま出す場所と端末の時刻帯で出す場所が混ざり、同じ動画の日付がページによって1日ずれていた（195章） */
export function jstDate(iso: string): { y: number; m: number; d: number } {
  const t = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** 表の列を揃えるための固定幅の日付（例: 2025/09/07）。月・日をゼロ埋めする。 */
export function formatDateFixed(iso: string): string {
  const { y, m, d } = jstDate(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}/${pad(m)}/${pad(d)}`;
}

/** 動画の長さ（YouTubeの PT20M4S 形式）を 20:04 のように直す。分からなければ空文字 */
export function formatDuration(iso?: string): string {
  const m = iso?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return "";
  const [h, min, s] = [m[1], m[2], m[3]].map((x) => Number(x || 0));
  if (h + min + s === 0) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(min)}:${pad(s)}` : `${min}:${pad(s)}`;
}

/** 点で区切った固定幅の日付（例: 2025.09.07） */
export function formatDateDot(iso: string): string {
  return formatDateFixed(iso).replaceAll("/", ".");
}

export function formatJaDate(iso: string): string {
  const { y, m, d } = jstDate(iso);
  return `${y}年${m}月${d}日`;
}

/** Rakuten の画像リンクHTMLから最初の img src を取り出す（構造化データ用）。 */
export function extractImageSrc(html?: string): string | undefined {
  return html?.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];
}

/**
 * 商品の画像と、それに合わせた価格・購入リンク。楽天の画像があれば楽天を使い、
 * 楽天の画像が無く、Yahoo!ショッピングのリンクと画像があればYahoo!の画像・価格を使う（115章）。
 * 画像の無い商品は購入できないリンクの可能性が高いので、価格は出さない（従来どおり）。
 */
export function productOffer(entry?: CosmeticListEntry, fallbackHtml?: string) {
  const rakutenSrc = extractImageSrc(entry?.rakuten_image_link || fallbackHtml);
  if (rakutenSrc) {
    return { imageSrc: rakutenSrc, source: "rakuten" as const, price: entry?.now_price, priceUpdated: entry?.price_updated, rakutenLink: entry?.rakuten_text_link || undefined };
  }
  if (entry?.yahoo_text_link && entry.yahoo_image_url) {
    return { imageSrc: entry.yahoo_image_url, source: "yahoo" as const, price: entry.yahoo_price, priceUpdated: entry.yahoo_price_updated, rakutenLink: undefined };
  }
  return { imageSrc: "", source: undefined, price: undefined, priceUpdated: undefined, rakutenLink: undefined };
}

/** Amazonアソシエイトのトラッキングタグ（公開して問題ない値） */
export const AMAZON_ASSOCIATE_TAG = "osorocosme-22";

/**
 * Amazonでの検索結果へのリンク（アソシエイトタグ付き）。AmazonのAPIは売上の実績が無いと使えないため、
 * 商品は特定せず「ブランド名＋商品名」の検索結果に飛ばす（206章）。
 */
export function amazonSearchUrl(brand: string, name: string): string {
  const q = `${brand} ${name}`.replace(/\s+/g, " ").trim();
  return `https://www.amazon.co.jp/s?k=${encodeURIComponent(q)}&tag=${AMAZON_ASSOCIATE_TAG}`;
}

export function productImageSrc(entry?: CosmeticListEntry, fallbackHtml?: string): string {
  return productOffer(entry, fallbackHtml).imageSrc;
}

export function breadcrumbLd(items: { name: string; path: string }[], site: URL) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: new URL(withBase(it.path), site).href,
    })),
  };
}

// ---- ブランドの国・系列（brand-meta.json。確認済みのものだけ収録し、不明は空欄） ----

export interface BrandMeta {
  country?: string; // ISO 3166-1 alpha-2
  group?: string; // 親会社・系列
}
const brandMeta = brandMetaData as unknown as Record<string, BrandMeta>;

export const COUNTRY_NAMES: Record<string, string> = {
  JP: "日本", KR: "韓国", FR: "フランス", US: "アメリカ", GB: "イギリス", IT: "イタリア",
  CA: "カナダ", DE: "ドイツ", AU: "オーストラリア", NZ: "ニュージーランド", CH: "スイス",
  IL: "イスラエル", ZA: "南アフリカ",
};

export function getBrandMeta(brand_id: string): BrandMeta {
  return brandMeta[brand_id] || {};
}

/** 画面の絞り込み用の区分。日本・韓国・その他（国不明はその他ではなく「不明」）。 */
export function getCountryRegion(brand_id: string): "JP" | "KR" | "OTHER" | "UNKNOWN" {
  const c = brandMeta[brand_id]?.country;
  if (!c) return "UNKNOWN";
  return c === "JP" || c === "KR" ? c : "OTHER";
}

export type BrandKind = "MAKE" | "SKIN" | "BOTH";

// タグからの自動判定が実態と合わないブランドの手動補正
const BRAND_KIND_OVERRIDES: Record<string, BrandKind> = {
  "brand-00510": "SKIN", // ユースキン（ハンドクリーム等。動画データ上のタグが不正確）
  "brand-00044": "SKIN", // ヴァセリン（ボディ・リップ等のケア用品）
};

/** ブランドがメイク系かスキンケア系かを、紹介コスメのカテゴリの比率から判定する。
 * スキンケア系タグが2割以下ならメイク系、8割以上ならスキンケア系、その間は両方。 */
export function getBrandKind(brand_id: string): BrandKind {
  if (BRAND_KIND_OVERRIDES[brand_id]) return BRAND_KIND_OVERRIDES[brand_id];
  const skin = new Set(RANKING_CATEGORY_GROUPS.find((g) => g.group === "スキンケア")!.tags);
  let mk = 0, sk = 0;
  for (const r of getCosmeticRankings()) {
    if (canonicalBrandId(r.brand_id) !== canonicalBrandId(brand_id)) continue;
    for (const t of r.tags) (skin.has(t) ? sk++ : mk++);
  }
  if (mk + sk === 0) return "BOTH";
  const ratio = sk / (mk + sk);
  return ratio <= 0.2 ? "MAKE" : ratio >= 0.8 ? "SKIN" : "BOTH";
}

export interface BrandGroupStats {
  group: string;
  brands: (BrandWithStats & { kind: BrandKind })[]; // 紹介動画数の多い順
  videoCount: number; // 系列内ブランドの紹介動画数の合計（同じ動画に複数ブランドが出ると重複して数える）
}

/** 系列ごとに、掲載ブランドと紹介動画数の合計をまとめる（系列が分かっているブランドのみ）。 */
export function getBrandGroups(): BrandGroupStats[] {
  const map = new Map<string, (BrandWithStats & { kind: BrandKind })[]>();
  for (const b of getBrandsWithVideos()) {
    const g = brandMeta[b.brand_id]?.group;
    if (!g) continue;
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push({ ...b, kind: getBrandKind(b.brand_id) });
  }
  return Array.from(map.entries())
    .map(([group, brands]) => {
      brands.sort((a, b) => b.videoCount - a.videoCount);
      return { group, brands, videoCount: brands.reduce((s, b) => s + b.videoCount, 0) };
    })
    .sort((a, b) => b.videoCount - a.videoCount);
}

export interface BrandCategorySection {
  group: string;
  tag: string;
  items: Cosmetic[];
}

/** ブランドの紹介コスメを、ランキングと同じ大分類・カテゴリ順に分ける。
 * 複数タグを持つコスメは、表示順で最も早いカテゴリに1回だけ入れる（重複表示を避ける）。
 * タグが無いコスメは末尾の「その他」へ。 */
export function getBrandCosmeticsByCategory(brand_id: string): BrandCategorySection[] {
  const tagsByKey = new Map(getCosmeticRankings().map((r) => [`${r.brand_id}_${r.name_id}`, r.tags]));
  const cosmetics = getCosmeticsForBrand(brand_id);

  const allTags = new Set<string>();
  const tagsOf = (c: Cosmetic) => tagsByKey.get(`${c.brand_id}_${c.name_id}`) ?? c.related_tags ?? [];
  for (const c of cosmetics) tagsOf(c).forEach((t) => allTags.add(t));
  const ordered = groupTagsByCategory(allTags).flatMap((g) => g.tags.map((tag) => ({ group: g.group, tag })));
  const rank = new Map(ordered.map((o, i) => [o.tag, i]));

  const buckets = new Map<string, Cosmetic[]>();
  for (const c of cosmetics) {
    const tags = tagsOf(c).filter((t) => rank.has(t));
    const main = tags.length > 0 ? tags.sort((a, b) => rank.get(a)! - rank.get(b)!)[0] : "その他";
    if (!buckets.has(main)) buckets.set(main, []);
    buckets.get(main)!.push(c);
  }
  const sections: BrandCategorySection[] = ordered
    .filter((o) => buckets.has(o.tag))
    .map((o) => ({ ...o, items: buckets.get(o.tag)! }));
  if (buckets.has("その他")) sections.push({ group: "その他", tag: "その他", items: buckets.get("その他")! });
  return sections;
}
