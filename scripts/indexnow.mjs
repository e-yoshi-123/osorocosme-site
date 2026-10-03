// IndexNow で、更新したページを Bing などへ知らせる（Google は非対応。履歴213章）。
// 鍵はサイト直下の public/<KEY>.txt（公開する前提の値で、秘密ではない）。
//
// 使い方:
//   node scripts/indexnow.mjs diff <前回の sitemap.xml> <今回の sitemap.xml> > urls.txt
//     新しく載った URL と lastmod が変わった URL を1行1件で出す。前回のファイルが空・無いときは何も出さない（全件を送らない）
//   node scripts/indexnow.mjs send <urls.txt>
//     api.indexnow.org へ送る（1回1万件まで）。0件なら何もしない
import { existsSync, readFileSync } from "node:fs";

const KEY = "dc27e6da5b0e3123ea81b3b3bde4dacf";
const HOST = "osorocosme.com";
const BATCH = 10000;

function parse(path) {
  const map = new Map();
  if (!existsSync(path)) return map;
  const xml = readFileSync(path, "utf8");
  for (const m of xml.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?<\/url>/g)) map.set(m[1], m[2] || "");
  return map;
}

async function send(urls) {
  for (let i = 0; i < urls.length; i += BATCH) {
    const urlList = urls.slice(i, i + BATCH);
    const res = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList }),
    });
    // 200・202 が受付。それ以外は本文ごと出して失敗にする
    console.log(`IndexNow: ${urlList.length} 件 → HTTP ${res.status}`);
    if (res.status !== 200 && res.status !== 202) {
      console.log(await res.text());
      process.exitCode = 1;
    }
  }
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === "diff") {
  const prev = parse(a);
  const next = parse(b);
  if (prev.size === 0) {
    console.error("前回の sitemap が読めないので、送る URL は無しにする");
  } else {
    const changed = [...next].filter(([loc, mod]) => prev.get(loc) !== mod).map(([loc]) => loc);
    console.error(`sitemap の差分: 新規・更新 ${changed.length} 件（全 ${next.size} 件）`);
    if (changed.length) console.log(changed.join("\n"));
  }
} else if (cmd === "send") {
  const urls = existsSync(a) ? readFileSync(a, "utf8").split("\n").filter(Boolean) : [];
  if (urls.length === 0) console.log("IndexNow: 送る URL なし");
  else await send(urls);
} else {
  console.error("使い方: node scripts/indexnow.mjs diff <前回> <今回> | send <urls.txt>");
  process.exit(2);
}
