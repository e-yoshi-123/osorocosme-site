import type { APIRoute } from "astro";
import { buildRecommendIndex } from "../lib/search-index";

export const prerender = true;

/** マイコスメ（/my-cosme/）のおすすめ・商品の追加の候補に使う元データ。中身は buildRecommendIndex の説明を参照 */
export const GET: APIRoute = () =>
  new Response(JSON.stringify(buildRecommendIndex()), {
    headers: { "Content-Type": "application/json" },
  });
