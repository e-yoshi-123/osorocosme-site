import type { APIRoute } from "astro";
import brandSearchAliases from "../../data/brand-search-aliases.json";
import {
  getVisibleVideos,
  getCosmeticFacts,
  getCosmeticRankings,
  getRepeatUsers,
  getInfluencerProfile,
  getVideoColorMap,
  getOfficialFacts,
  cosmeticHref,
  canonicalBrandId,
  rankingTag,
  isOwnBrandMention,
  REPEAT_MIN_GAP_DAYS,
} from "../../lib/data";
import { sceneSeconds } from "../../lib/recipe";

export const prerender = true;

/**
 * AIのエージェント向けの入口（MCPサーバー、backend の mcp/）が読むデータ（379章）。
 * サイトに出している事実（誰が・いつ・どの動画の何分で・PRかどうか・リピート・使った色・発言）だけを、配列でまとめる。
 * YouTube APIの数（登録者数・再生回数）は入れない（決定事項）。中身は下の型の説明を参照
 */
type Intro = [
  number, // 動画（videos の番号）
  number, // 紹介した場面の秒（無ければ -1）
  0 | 1 | 2, // 0＝ふつう、1＝PR・提供、2＝本人のブランド
  string, // その動画で使った色（「、」区切り。無ければ空）
  string, // 発言（引用できるもの1つ。無ければ空）
  string, // 肌悩みに触れた紹介なら、その悩み（「、」区切り）
];

export const GET: APIRoute = () => {
  const aliases = brandSearchAliases as unknown as Record<string, string[] | string>;
  const videos = getVisibleVideos();
  const channels: [string, string, string, string][] = []; // [channel_id, 名前, パーソナルカラー, 肌質]（本人が話したもの）
  const chIdx = new Map<string, number>();
  const ch = (id: string, title: string) => {
    let i = chIdx.get(id);
    if (i === undefined) {
      const p = getInfluencerProfile(id);
      i = channels.push([id, title, p?.personal_color ?? "", p?.skin ?? ""]) - 1;
      chIdx.set(id, i);
    }
    return i;
  };
  const videoRows: [string, string, string, number, string][] = []; // [video_key, YouTubeの動画ID, 題名, channels の番号, 投稿日]
  const vIdx = new Map<string, number>();
  const products = new Map<string, { brand_id: string; name_id: string; brand: string; name: string; tags: Set<string> }>();
  for (const v of videos) {
    vIdx.set(v.key, videoRows.push([v.key, v.video_id, v.title, ch(v.channel_id, v.channel_title), (v.published_at || "").slice(0, 10)]) - 1);
    for (const c of v.cosmetics || []) {
      if (!c.brand_id || !c.name_id || !c.brand || !c.name) continue;
      const key = `${c.brand_id}_${c.name_id}`;
      let p = products.get(key);
      if (!p) products.set(key, (p = { brand_id: c.brand_id, name_id: c.name_id, brand: c.brand, name: c.name, tags: new Set() }));
      for (const t of c.related_tags || []) p.tags.add(rankingTag(t));
    }
  }
  const rankTags = new Map(getCosmeticRankings().map((r) => [`${r.brand_id}_${r.name_id}`, r.tags]));
  const brands: [string, string][] = []; // [ブランド名, 別名（空白区切り）]
  const bIdx = new Map<string, number>();
  const rows = [];
  for (const [key, p] of products) {
    const bid = canonicalBrandId(p.brand_id);
    let bi = bIdx.get(bid);
    if (bi === undefined) {
      const a = aliases[bid] ?? aliases[p.brand_id];
      bi = brands.push([p.brand, Array.isArray(a) ? a.join(" ") : a ?? ""]) - 1;
      bIdx.set(bid, bi);
    }
    const facts = getCosmeticFacts(p.brand_id, p.name_id);
    const colorMap = getVideoColorMap(p.brand_id, p.name_id);
    const intros: Intro[] = facts.introductions.map((i) => {
      const v = videos[vIdx.get(i.videoKey)!];
      const c = v?.cosmetics?.find((x) => x.brand_id === p.brand_id && x.name_id === p.name_id);
      const sec = sceneSeconds(c?.time_in_video) ?? -1;
      return [
        vIdx.get(i.videoKey)!,
        sec,
        i.pr ? (isOwnBrandMention(i.videoKey, p.brand_id, p.name_id) ? 2 : 1) : 0,
        (colorMap.get(i.videoKey) || []).map((x) => x.label).join("、"),
        (i.quotes[0] || "").slice(0, 80),
        i.concerns.map((x) => x.name).join("、"),
      ];
    });
    const official = getOfficialFacts(p.brand_id, p.name_id);
    rows.push([
      bi,
      p.name,
      cosmeticHref(p.brand_id, p.name_id),
      [...(rankTags.get(key) ?? p.tags)],
      facts.mainTag ?? "",
      facts.rank ?? 0,
      facts.rankTotal ?? 0,
      official?.price ?? 0, // 公式の定価（税込み。無ければ0）
      getRepeatUsers(p.brand_id, p.name_id).map((u) => [chIdx.get(u.channel_id)!, u.videoCount, u.first.slice(0, 10), u.last.slice(0, 10)]),
      intros,
    ]);
  }
  const body = {
    version: 1,
    generated_at: new Date().toISOString(),
    site: "https://osorocosme.com",
    notes: {
      repeat: `同じ人が${REPEAT_MIN_GAP_DAYS}日以上あけて2本以上の動画で紹介した（PR・提供を除く）`,
      pr: "PR・提供（概要欄の記載・YouTubeの有料プロモーション表示）と本人のブランドの紹介は、ランキング・リピートに数えない",
      rank: "紹介動画数・紹介した人数から算出したカテゴリ内の順位（収録した動画の範囲での集計で、品質評価ではない）",
    },
    // products の行：[brands の番号, 商品名, ページのパス, カテゴリ, 主カテゴリ, 主カテゴリの順位, その品数, 公式の定価, リピート[[channels の番号, 本数, 最初, 最後]], 紹介[Intro]]
    brands,
    channels,
    videos: videoRows,
    products: rows,
  };
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
};
