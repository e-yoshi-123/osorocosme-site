import type { APIRoute } from "astro";
import { withBase } from "../lib/data";

export const prerender = true;

// 検索エンジンだけでなく、AI検索・AIアシスタントのクローラーにも引用元として読まれることを許可する。
export const GET: APIRoute = ({ site }) => {
  const ai = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Google-Extended"];
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: " + withBase("/search-result"),
    "",
    ...ai.flatMap((a) => [`User-agent: ${a}`, "Allow: /", ""]),
    `Sitemap: ${new URL(withBase("/sitemap.xml"), site).href}`,
    "",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
