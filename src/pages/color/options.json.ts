import type { APIRoute } from "astro";
import { getAllCosmeticColorOptions } from "../../lib/data";

export const prerender = true;

/** マイコスメで「持っている色・気になる色」を選ぶ候補：商品（slug）→ [[公式の色の表示名, #RRGGBB か空], ...]（363章。my-cosme-page.ts が、色を選ぶときに初めて読む） */
export const GET: APIRoute = () =>
  new Response(JSON.stringify(getAllCosmeticColorOptions()), {
    headers: { "Content-Type": "application/json" },
  });
