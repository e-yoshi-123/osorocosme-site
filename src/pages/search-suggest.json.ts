import type { APIRoute } from "astro";
import { buildSearchIndex, RAKUTEN_IMG_HEAD, RAKUTEN_IMG_TAIL } from "../lib/search-index";
import { getExploreEntries } from "../lib/data";

export const prerender = true;

/** 検索欄の候補（scripts/search-suggest.ts が、入力欄に触れたときに読む）。
 * 検索結果の索引（約3.4MB）から、名前で引くのに要る項目だけを抜いた軽い版（動画・概要欄は持たない）。
 * - b（ブランド）: [brand_id, 名前, 別名（空白区切り）, 動画数]
 * - i（インフルエンサー）: [channel_id, 名前, アイコン, 動画数]
 * - c（コスメ）: [slug, ブランド名, bの番号（ページの無いブランドは-1）, 商品名, 動画数, カテゴリ（＋通称）, 画像]
 *   画像は楽天の240pxのものなら頭と尾を省いて「~」で始める（recommend.json と同じ。276章）。無ければ空
 * - x（探し方のページ。247章）: [種類（肌悩み・成分・特集・ランキング）, 名前, パス, 引ける語（空白区切り）, 品数] */
export const GET: APIRoute = () => {
  const idx = buildSearchIndex();
  const b = idx.b.map((x) => [x[0], x[1], x[2], x[3]]);
  const i = idx.i.map((x) => [x[0], x[1], x[2], x[4]]);
  const shortImg = (src: string) =>
    src.startsWith(RAKUTEN_IMG_HEAD) && src.endsWith(RAKUTEN_IMG_TAIL) ? `~${src.slice(RAKUTEN_IMG_HEAD.length, -RAKUTEN_IMG_TAIL.length)}` : src;
  const c = idx.c.map((x) => [x[0], x[1], x[2], x[3], x[6], x[5], shortImg(String(x[4] || ""))]);
  const x = getExploreEntries().map((e) => [e.kind, e.label, e.path, e.words.join(" "), e.count]);
  return new Response(JSON.stringify({ b, i, c, x }), {
    headers: { "Content-Type": "application/json" },
  });
};
