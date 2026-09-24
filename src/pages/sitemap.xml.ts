import type { APIRoute } from "astro";
import {
  getVisibleVideos,
  getBrandsWithVideos,
  getUsedCosmeticKeys,
  getInfluencerRanking,
  getRankingPages,
  FEATURES,
  getVideosUsingCosmetic,
  getVideosByChannel,
  sortByPublishedDesc,
  cosmeticSlug,
  withBase,
} from "../lib/data";

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  // lastmod は「そのページに関係する最新の動画の投稿日」。更新の目安をクローラーに伝える
  const day = (iso?: string) => (iso ? iso.slice(0, 10) : undefined);
  const newest = (list: { published_at: string }[]) => day(sortByPublishedDesc(list)[0]?.published_at);
  const videos = getVisibleVideos();
  const siteNewest = newest(videos);
  const brandNewest = new Map<string, string>();
  for (const v of videos) {
    for (const c of v.cosmetics || []) {
      const d = day(v.published_at)!;
      if (!brandNewest.has(c.brand_id) || brandNewest.get(c.brand_id)! < d) brandNewest.set(c.brand_id, d);
    }
  }
  const items: { path: string; lastmod?: string }[] = [
    { path: "/", lastmod: siteNewest },
    { path: "/ranking/", lastmod: siteNewest },
    ...Array.from(getRankingPages().keys()).map((t) => ({ path: `/ranking/${encodeURIComponent(t)}/`, lastmod: siteNewest })),
    { path: "/feature/", lastmod: siteNewest },
    ...FEATURES.map((f) => ({ path: `/feature/${f.slug}/`, lastmod: siteNewest })),
    { path: "/brand-list", lastmod: siteNewest },
    { path: "/influencer-list", lastmod: siteNewest },
    { path: "/video-list", lastmod: siteNewest },
    ...getBrandsWithVideos().map((b) => ({ path: `/brand/${b.brand_id}`, lastmod: brandNewest.get(b.brand_id) })),
    ...getUsedCosmeticKeys().map((k) => ({ path: `/cosmetics/${cosmeticSlug(k.brand_id, k.name_id)}`, lastmod: newest(getVideosUsingCosmetic(k.brand_id, k.name_id)) })),
    ...getInfluencerRanking().map((i) => ({ path: `/influencer/${i.channel_id}`, lastmod: newest(getVideosByChannel(i.channel_id)) })),
    ...videos.map((v) => ({ path: `/video/${v.key}`, lastmod: day(v.published_at) })),
  ];
  const urls = items
    .map((it) => `  <url><loc>${new URL(withBase(it.path), site).href}</loc>${it.lastmod ? `<lastmod>${it.lastmod}</lastmod>` : ""}</url>`)
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
};
