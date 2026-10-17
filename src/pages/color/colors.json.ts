import type { APIRoute } from "astro";
import { getColorSearchData } from "../../lib/data";

export const prerender = true;

/** 色から探す（/color/）が読む、品と色の値の一覧（362章。項目の並びは data.ts の ColorSearchData） */
export const GET: APIRoute = () =>
  new Response(JSON.stringify(getColorSearchData()), {
    headers: { "Content-Type": "application/json" },
  });
