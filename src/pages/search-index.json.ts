import type { APIRoute } from "astro";
import { buildSearchIndex } from "../lib/search-index";

export const prerender = true;

/** サイト内検索の索引（search-result.astro が読む。項目の並びは lib/search-index.ts） */
export const GET: APIRoute = () =>
  new Response(JSON.stringify(buildSearchIndex()), {
    headers: { "Content-Type": "application/json" },
  });
