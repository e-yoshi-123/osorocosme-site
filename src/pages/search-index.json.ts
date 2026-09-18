import type { APIRoute } from "astro";
import { getVisibleVideos } from "../lib/data";

export const prerender = true;

export const GET: APIRoute = () => {
  const items = getVisibleVideos().map((v) => ({
    key: v.key,
    title: v.title,
    channel_title: v.channel_title,
    description: v.description,
    thumbnail: v.thumbnail,
    published_at: v.published_at,
    cosmetics: (v.cosmetics || [])
      .filter((c) => c.brand && c.name)
      .map((c) => ({ brand: c.brand, name: c.name })),
  }));
  return new Response(JSON.stringify(items), {
    headers: { "Content-Type": "application/json" },
  });
};
