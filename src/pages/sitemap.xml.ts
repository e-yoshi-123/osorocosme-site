import type { APIRoute } from "astro";
import {
  getVisibleVideos,
  getBrandsWithVideos,
  getUsedCosmeticKeys,
  getInfluencerRanking,
  getRankingPages,
  cosmeticSlug,
  withBase,
} from "../lib/data";

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const paths = [
    "/",
    "/ranking/",
    ...Array.from(getRankingPages().keys()).map((t) => `/ranking/${encodeURIComponent(t)}/`),
    "/brand-list",
    "/influencer-list",
    "/video-list",
    ...getBrandsWithVideos().map((b) => `/brand/${b.brand_id}`),
    ...getUsedCosmeticKeys().map((k) => `/cosmetics/${cosmeticSlug(k.brand_id, k.name_id)}`),
    ...getInfluencerRanking().map((i) => `/influencer/${i.channel_id}`),
    ...getVisibleVideos().map((v) => `/video/${v.key}`),
  ];
  const urls = paths.map((p) => `  <url><loc>${new URL(withBase(p), site).href}</loc></url>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
};
