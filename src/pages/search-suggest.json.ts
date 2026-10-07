import type { APIRoute } from "astro";
import { buildSearchIndex } from "../lib/search-index";

export const prerender = true;

/** 検索欄の候補（scripts/search-suggest.ts が、入力欄に触れたときに読む）。
 * 検索結果の索引（約3.4MB）から、名前で引くのに要る項目だけを抜いた軽い版（動画・概要欄・コスメの画像は持たない）。
 * - b（ブランド）: [brand_id, 名前, 別名（空白区切り）, 動画数]
 * - i（インフルエンサー）: [channel_id, 名前, アイコン, 動画数]
 * - c（コスメ）: [slug, ブランド名, bの番号（ページの無いブランドは-1）, 商品名, 動画数, カテゴリ（＋通称）] */
export const GET: APIRoute = () => {
  const idx = buildSearchIndex();
  const b = idx.b.map((x) => [x[0], x[1], x[2], x[3]]);
  const i = idx.i.map((x) => [x[0], x[1], x[2], x[4]]);
  const c = idx.c.map((x) => [x[0], x[1], x[2], x[3], x[6], x[5]]);
  return new Response(JSON.stringify({ b, i, c }), {
    headers: { "Content-Type": "application/json" },
  });
};
