import type { APIRoute } from "astro";
import {
  getVisibleVideos,
  getBrandsWithVideos,
  getUsedCosmeticKeys,
  canonicalBrandId,
  getInfluencerRanking,
  getRankingPages,
  getPublishedFeatures,
  getVideosUsingCosmetic,
  COSMETIC_INDEX_MIN_VIDEOS,
  getVideosByChannel,
  cosmeticSlug,
  withBase,
} from "../lib/data";

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  // lastmod は「そのページに関係する動画の、商品データが最後に変わった日」の最新。更新の目安をクローラーに伝える。
  // 動画ごとの日は updated_at（公開時に付く）と投稿日の遅いほう。古い動画を後から載せたときも、そのページの日付が進む
  const day = (iso?: string) => (iso ? iso.slice(0, 10) : undefined);
  const touched = (v: { published_at: string; updated_at?: string }) => {
    const p = day(v.published_at);
    return v.updated_at && (!p || v.updated_at > p) ? v.updated_at : p;
  };
  const newest = (list: { published_at: string; updated_at?: string }[]) =>
    list.reduce<string | undefined>((m, v) => {
      const d = touched(v);
      return d && (!m || d > m) ? d : m;
    }, undefined);
  const videos = getVisibleVideos();
  const siteNewest = newest(videos);
  const brandNewest = new Map<string, string>();
  for (const v of videos) {
    for (const c of v.cosmetics || []) {
      const d = touched(v)!;
      const bid = canonicalBrandId(c.brand_id);
      if (!brandNewest.has(bid) || brandNewest.get(bid)! < d) brandNewest.set(bid, d);
    }
  }
  const items: { path: string; lastmod?: string }[] = [
    { path: "/", lastmod: siteNewest },
    { path: "/ranking/", lastmod: siteNewest },
    ...Array.from(getRankingPages().keys()).map((t) => ({ path: `/ranking/${encodeURIComponent(t)}/`, lastmod: siteNewest })),
    { path: "/feature/", lastmod: siteNewest },
    ...getPublishedFeatures().map((f) => ({ path: `/feature/${f.slug}/`, lastmod: siteNewest })),
    { path: "/brand-list", lastmod: siteNewest },
    { path: "/influencer-list", lastmod: siteNewest },
    { path: "/video-list", lastmod: siteNewest },
    ...getBrandsWithVideos().map((b) => ({ path: `/brand/${b.brand_id}`, lastmod: brandNewest.get(b.brand_id) })),
    ...getUsedCosmeticKeys().flatMap((k) => {
      const using = getVideosUsingCosmetic(k.brand_id, k.name_id);
      if (using.length < COSMETIC_INDEX_MIN_VIDEOS) return []; // noindex のページは載せない
      return [{ path: `/cosmetics/${cosmeticSlug(k.brand_id, k.name_id)}`, lastmod: newest(using) }];
    }),
    ...getInfluencerRanking().map((i) => ({ path: `/influencer/${i.channel_id}`, lastmod: newest(getVideosByChannel(i.channel_id)) })),
    ...videos.map((v) => ({ path: `/video/${v.key}`, lastmod: touched(v) })),
  ];
  const urls = items
    .map((it) => `  <url><loc>${new URL(withBase(it.path), site).href}</loc>${it.lastmod ? `<lastmod>${it.lastmod}</lastmod>` : ""}</url>`)
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
};
