/** マイコスメのページ（/my-cosme/）：登録した一覧（使っている・気になる）・商品の追加・おすすめ（5-3）・書き出しと読み込み・Googleドライブ同期（5-4）。
 * おすすめは「使っている」だけから出す。「気になる」は控えの一覧（259章）。
 * 肌悩み（259章）：選んだ悩みごとに、/concern/ と同じ集計（悩みに触れて紹介した人の数）で「肌悩みから」の欄を出す。
 * ほかのおすすめでも、選んだ悩みで紹介された商品は点数を CONCERN_WEIGHT 倍だけ上げる。
 * 元データは recommend.json（lib/search-index.ts の buildRecommendIndex）。計算はすべてブラウザの中で行い、一覧はどこにも送らない。
 *
 * おすすめの考え方：登録したコスメを紹介したインフルエンサー（チャンネル）が、ほかに紹介しているコスメを集める。
 * チャンネルの重みは、登録したコスメのうちそのチャンネルが紹介した品数（好みが近いほど重い）。
 * 点数＝重みの合計÷√（その商品を紹介したチャンネル数）。割らないと、誰の一覧にも出る定番ばかりが上に来る（試した結果、√で割るのが釣り合った）。
 * 2チャンネル以上から挙がった商品だけを出す（1人だけの好みに引っ張られないように）。PR・提供の紹介は元データの時点で除いてある。
 * 成分の近さ（5-3）：登録したコスメの公式の全成分に入っている成分（成分のページがあるもの）を数え、候補の成分がそれをどれだけ覆うか（0〜1）で
 * 点数を最大 ING_WEIGHT 倍まで上げる。よく入っている成分ごとに、その成分が入ったスキンケアの欄も出す。効能は書かず、成分名の事実だけを出す。 */
import { norm, splitTerms } from "../lib/search-norm";
import { load, add, remove, has, save, merge, sanitize, exportText, onChange, type MyCosmeData, type ListKind } from "./my-cosme-store";
import { sync, pushIfConnected, disconnect, isConnected } from "./my-cosme-drive";

type CosRow = [string, string, number, string, string, string, number];
interface RecIndex {
  b: [string, string][];
  c: CosRow[];
  ch: [string, string, string, number[]][];
  r: Record<string, string>;
  /** 成分：[slug, 名前] */
  g: [string, string][];
  /** 商品の番号 → 全成分に入っている成分（g の番号） */
  gi: Record<string, number[]>;
  /** 肌悩み：[slug, 名前, 商品の番号（紹介した人の多い順）, 同じ並びの紹介した人数] */
  k: [string, string, number[], number[]][];
}

const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL.slice(0, -1) : import.meta.env.BASE_URL;
const IMG_HEAD = "https://thumbnail.image.rakuten.co.jp/@0_mall/";
const root = document.getElementById("my-cosme")!;
const clientId = root.dataset.googleClientId || "";
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
/** 左の欄で開いている一覧 */
let tab: ListKind = "items";
const LIST_LABEL = { items: "使っている", wish: "気になる" } as const;

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const img = (s: string, size = 300) => (s.startsWith("~") ? `${IMG_HEAD}${s.slice(1)}?_ex=${size}x${size}` : s);
const track = (action: string) => {
  // 使われ方だけを数える（どの商品かは送らない。決定事項）
  const g = (window as unknown as { gtag?: (...a: unknown[]) => void }).gtag;
  if (typeof g === "function") g("event", "my_cosme", { action });
};

// ---- 元データ ----
interface Prepared {
  idx: RecIndex;
  bySlug: Map<string, number>;
  hay: string[];
  names: string[];
  /** 商品ごとの、紹介したチャンネル数（PR・提供を除く） */
  chCount: Int32Array;
}
let prepared: Prepared | undefined;
async function prepare(): Promise<Prepared> {
  if (prepared) return prepared;
  const idx = (await (await fetch(`${base}/recommend.json`)).json()) as RecIndex;
  for (const c of idx.c) if (!c[1] && c[2] >= 0) c[1] = idx.b[c[2]][0]; // 省いたブランド名を戻す
  const brandHay = idx.b.map(([n, kw]) => [norm(n), ...kw.split(" ").map(norm)].filter(Boolean).join("|"));
  const names = idx.c.map((c) => norm(c[3]));
  const chCount = new Int32Array(idx.c.length);
  for (const ch of idx.ch) for (const n of ch[3]) chCount[n]++;
  prepared = {
    idx,
    bySlug: new Map(idx.c.map((c, n) => [c[0], n])),
    names,
    hay: idx.c.map((c, n) => `${norm(c[1])}|${c[2] >= 0 ? brandHay[c[2]] : ""}|${names[n]}|${norm(c[5])}`),
    chCount,
  };
  return prepared;
}

/** 保存した slug を、今の商品の番号にする（統合で寄せられた商品は寄せ先へ） */
function resolve(p: Prepared, slug: string): number | undefined {
  return p.bySlug.get(slug) ?? (p.idx.r[slug] ? p.bySlug.get(p.idx.r[slug]) : undefined);
}

// ---- 表示の部品 ----
/** おすすめ等の商品に付ける「使っている」「気になる」のボタン（押すと入れる・もう一度押すと外す） */
function listButtons(slug: string, d: MyCosmeData): string {
  const b = (kind: ListKind, icon: string) => {
    const on = !!d[kind][slug];
    return `<button type="button" data-toggle="${kind}" data-slug="${esc(slug)}" aria-pressed="${on}" class="inline-flex items-center gap-1 min-h-8 px-3 rounded-full text-xs border transition-colors cursor-pointer ${on ? "bg-rose border-rose text-white" : "border-rose/40 text-rose hover:bg-rose/10"}">${on ? "✓" : icon} ${LIST_LABEL[kind]}</button>`;
  };
  return `<div class="mt-2 flex flex-wrap gap-1.5">${b("items", "＋")}${b("wish", "♡")}</div>`;
}
function tile(p: Prepared, n: number, caption: string, d: MyCosmeData): string {
  const c = p.idx.c[n];
  const src = img(c[4]);
  const pic = src
    ? `<img src="${esc(src)}" alt="${esc(`${c[1]} ${c[3]}`)}" loading="lazy" class="w-full h-full object-contain p-[11%]" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'noimg',textContent:'No image'}))" />`
    : `<span class="noimg">No image</span>`;
  return `<div class="min-w-0">
    <a href="${base}/cosmetics/${esc(c[0])}/" class="block group">
      <div class="product-well relative aspect-square rounded-2xl flex items-center justify-center overflow-hidden">${pic}</div>
      <p class="mt-3 text-xs tracking-[0.14em] text-neutral-500 truncate">${esc(c[1])}</p>
      <p class="mt-1 phrase text-sm leading-snug line-clamp-2 group-hover:text-rose transition-colors">${esc(c[3])}</p>
    </a>
    <p class="mt-1.5 text-xs leading-relaxed text-neutral-500">${caption}</p>
    ${listButtons(c[0], d)}
  </div>`;
}

// ---- 登録した一覧 ----
const EMPTY_TEXT = {
  items: "まだ登録されていません。上の欄で探すか、右の人気のコスメから追加してください。",
  wish: "まだありません。上の欄で探すか、おすすめや商品ページの「気になる」から追加してください。買って使い始めたら「使い始めた」で「使っている」へ移せます。",
};
function renderList(p: Prepared, d: MyCosmeData) {
  const entries = Object.entries(d[tab]).sort((a, b) => b[1].t - a[1].t);
  $("[data-count]").textContent = String(entries.length);
  $("[data-count-items]").textContent = String(Object.keys(d.items).length);
  $("[data-count-wish]").textContent = String(Object.keys(d.wish).length);
  $("[data-list-title]").textContent = LIST_LABEL[tab];
  for (const b of root.querySelectorAll<HTMLElement>("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
  const list = $("[data-list]");
  $("[data-empty]").textContent = EMPTY_TEXT[tab];
  $("[data-empty]").hidden = entries.length > 0;
  const rmBtn = (slug: string, label: string) =>
    `<button type="button" data-remove="${esc(slug)}" data-kind="${tab}" class="shrink-0 w-9 h-9 rounded-full text-neutral-500 hover:bg-ink/5 hover:text-ink cursor-pointer" aria-label="${esc(label)}を一覧から外す">×</button>`;
  const moveBtn = (slug: string) =>
    tab === "wish" ? `<button type="button" data-move="${esc(slug)}" class="shrink-0 min-h-8 px-3 rounded-full border border-rose/40 text-xs text-rose hover:bg-rose hover:text-white transition-colors cursor-pointer">使い始めた</button>` : "";
  list.innerHTML = entries
    .map(([slug, it]) => {
      const n = resolve(p, slug);
      if (n === undefined) {
        // サイトに載らなくなった商品（紹介した動画が非公開になった等）。名前だけ出し、消せるようにしておく
        return `<li class="flex items-center gap-3 py-3 border-b border-ink/10"><span class="w-12 h-12 shrink-0 rounded-xl product-well"></span><span class="flex-1 min-w-0 text-sm text-neutral-500">${esc(it.n || slug)}<span class="block text-xs">いまは掲載していない商品です</span></span>${rmBtn(slug, it.n || "この商品")}</li>`;
      }
      const c = p.idx.c[n];
      const src = img(c[4], 128);
      return `<li class="flex items-center gap-3 py-3 border-b border-ink/10">
        <a href="${base}/cosmetics/${esc(c[0])}/" class="w-12 h-12 shrink-0 rounded-xl product-well flex items-center justify-center overflow-hidden">${src ? `<img src="${esc(src)}" alt="" loading="lazy" class="w-full h-full object-contain p-1" onerror="this.remove()" />` : ""}</a>
        <a href="${base}/cosmetics/${esc(c[0])}/" class="flex-1 min-w-0 group">
          <span class="block text-xs text-neutral-500 truncate">${esc(c[1])}${c[5] ? `・${esc(c[5])}` : ""}</span>
          <span class="block text-sm truncate group-hover:text-rose transition-colors">${esc(c[3])}</span>
        </a>
        ${moveBtn(slug)}${rmBtn(slug, c[3])}
      </li>`;
    })
    .join("");
}

// ---- 肌悩み ----
/** 選んだ悩み（選んだ順） */
function myConcerns(p: Prepared, d: MyCosmeData) {
  return p.idx.k.filter((k) => d.concerns[k[0]]).sort((a, b) => d.concerns[a[0]].t - d.concerns[b[0]].t);
}
function renderConcernChips(p: Prepared, d: MyCosmeData) {
  $("[data-concerns]").innerHTML = p.idx.k
    .map(([slug, name]) => {
      const on = !!d.concerns[slug];
      return `<button type="button" data-concern="${esc(slug)}" aria-pressed="${on}" class="min-h-9 px-4 rounded-full text-xs border transition-colors cursor-pointer ${on ? "bg-rose border-rose text-white" : "border-ink/20 text-neutral-700 hover:border-ink"}">${on ? "✓ " : ""}${esc(name)}</button>`;
    })
    .join("");
}
const CONCERN_LIMIT = 6, CONCERN_PER_CAT = 2;
function renderConcernRec(p: Prepared, d: MyCosmeData) {
  const box = $("[data-rec-concern]");
  const sel = myConcerns(p, d);
  box.hidden = sel.length === 0;
  if (!sel.length) return;
  const mine = new Set(Object.keys(d.items).map((s) => resolve(p, s)));
  $("[data-rec-concern-list]").innerHTML = sel
    .map(([slug, name, ns, cnt]) => {
      const per = new Map<string, number>();
      const list: [number, number][] = [];
      ns.forEach((n, i) => {
        if (list.length >= CONCERN_LIMIT || mine.has(n)) return;
        const cat = p.idx.c[n][5];
        if ((per.get(cat) || 0) >= CONCERN_PER_CAT) return;
        per.set(cat, (per.get(cat) || 0) + 1);
        list.push([n, cnt[i]]);
      });
      if (!list.length) return "";
      const cap = (n: number, c: number) => `${p.idx.c[n][5] ? `<span class="block truncate">${esc(p.idx.c[n][5])}</span>` : ""}<span class="block">「${esc(name)}」に触れて${c}人が紹介</span>`;
      return `<div class="min-w-0">
        <h3 class="text-sm font-medium">${esc(name)}</h3>
        <div class="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-8">${list.map(([n, c]) => tile(p, n, cap(n, c), d)).join("")}</div>
        <a href="${base}/concern/${esc(slug)}/" class="mt-4 inline-block text-xs text-rose hover:underline">${esc(name)}に触れて紹介されたコスメをもっと見る →</a>
      </div>`;
    })
    .join("");
}

// ---- あなたへのおすすめ（264章）：3つの理由をまとめて、その人だけの数品にする ----
// 理由ごとに0〜1にそろえて足す：①同じコスメを使う人（下のおすすめと同じ点数÷候補の最大）②選んだ肌悩みに触れて紹介した人数
// （その悩みで一番多い品を1）③登録したコスメと同じ成分（成分の近さ）。理由が重なる品ほど上に出し、カテゴリは1品ずつ。
// 理由は「〇〇に触れて紹介」「同じ成分」のように事実だけを書く（効能は書かない）。
const FORYOU_LIMIT = 6, FORYOU_MULTI = 0.5;
function renderForYou(p: Prepared, d: MyCosmeData) {
  const box = $("[data-foryou]");
  const mine = new Set<number>();
  for (const s of Object.keys(d.items)) {
    const n = resolve(p, s);
    if (n !== undefined) mine.add(n);
  }
  const concerns = myConcerns(p, d);
  box.hidden = mine.size === 0 && concerns.length === 0;
  if (box.hidden) return;

  // ①同じコスメを使う人
  const weight = new Map<number, number>();
  p.idx.ch.forEach((ch, k) => {
    let w = 0;
    for (const n of ch[3]) if (mine.has(n)) w++;
    if (w > 0) weight.set(k, w);
  });
  const raw = new Map<number, number>(), support = new Map<number, number>();
  for (const [k, w] of weight)
    for (const n of p.idx.ch[k][3]) {
      if (mine.has(n) || p.chCount[n] < 2) continue;
      raw.set(n, (raw.get(n) || 0) + w);
      support.set(n, (support.get(n) || 0) + 1);
    }
  const co = new Map<number, number>();
  for (const [n, s] of raw) if ((support.get(n) || 0) >= MIN_SUPPORT) co.set(n, s / Math.sqrt(p.chCount[n]));
  const coMax = Math.max(0, ...co.values());
  // ②肌悩み：品ごとに一番当てはまる悩み（紹介した人数がその悩みの一番多い品に近いほど1）
  const con = new Map<number, { v: number; name: string; cnt: number; also: string[] }>();
  for (const [, name, ns, cnt] of concerns) {
    const top = cnt[0] || 1;
    ns.forEach((n, i) => {
      if (mine.has(n)) return;
      const v = cnt[i] / top, cur = con.get(n);
      if (!cur) con.set(n, { v, name, cnt: cnt[i], also: [] });
      else if (v > cur.v) con.set(n, { v, name, cnt: cnt[i], also: [...cur.also, cur.name] });
      else cur.also.push(name);
    });
  }
  // ③成分：登録したコスメに入っている成分を、候補がどれだけ覆うか
  const ings = (n: number) => p.idx.gi[n] || [];
  const profile = new Map<number, number>();
  for (const n of mine) for (const g of ings(n)) profile.set(g, (profile.get(g) || 0) + 1);
  const mass = [...profile.values()].reduce((a, b) => a + b, 0);
  const ing = new Map<number, number>();
  if (mass)
    for (const key of Object.keys(p.idx.gi)) {
      const n = Number(key);
      if (mine.has(n) || p.chCount[n] < MIN_SUPPORT) continue;
      const v = ings(n).reduce((a, g) => a + (profile.get(g) || 0), 0) / mass;
      if (v > 0) ing.set(n, v);
    }

  const cands = new Set<number>([...co.keys(), ...con.keys(), ...ing.keys()]);
  const ranked = [...cands]
    .map((n) => {
      const a = coMax ? (co.get(n) || 0) / coMax : 0, b = con.get(n)?.v || 0, c = ing.get(n) || 0;
      const hits = (a > 0 ? 1 : 0) + (b > 0 ? 1 : 0) + (c > 0 ? 1 : 0);
      return { n, s: a + b + c + FORYOU_MULTI * (hits - 1) };
    })
    .sort((x, y) => y.s - x.s || p.idx.c[y.n][6] - p.idx.c[x.n][6]);
  // カテゴリは1品ずつ。ブランドもまず1品ずつにし、足りなければ同じブランドの2品目で埋める（1ブランドに偏らないように）
  const per = new Set<string>();
  const picks: number[] = [];
  for (const brandOnce of [true, false]) {
    const brands = new Set(picks.map((n) => p.idx.c[n][2]));
    for (const { n } of ranked) {
      if (picks.length >= FORYOU_LIMIT) break;
      const cat = p.idx.c[n][5], b = p.idx.c[n][2];
      if (picks.includes(n) || (cat && per.has(cat)) || (brandOnce && b >= 0 && brands.has(b))) continue;
      if (cat) per.add(cat);
      brands.add(b);
      picks.push(n);
    }
  }

  // 理由の行：登録したコスメの名前を添える（どの品と同じ人・同じ成分か）
  const short = (n: number) => esc(p.idx.c[n][3].length > 16 ? `${p.idx.c[n][3].slice(0, 15)}…` : p.idx.c[n][3]);
  const usedIng = new Map<number, number>();
  const reasons = (n: number) => {
    const out: string[] = [];
    const k = con.get(n);
    if (k) out.push(`「${esc([k.name, ...k.also].join("」「"))}」に触れて${k.cnt}人が紹介`);
    if (co.has(n)) {
      // この品を紹介した人がよく使っている、あなたのコスメ
      const hit = new Map<number, number>();
      for (const [ck] of weight) if (p.idx.ch[ck][3].includes(n)) for (const m of p.idx.ch[ck][3]) if (mine.has(m)) hit.set(m, (hit.get(m) || 0) + 1);
      const best = [...hit.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best) out.push(`あなたの「${short(best[0])}」を使う${support.get(n)}人も紹介`);
    }
    if (ing.has(n)) {
      // 同じ成分ばかり並ばないよう、まだ理由に出していない成分を先に選ぶ
      const g = ings(n).filter((x) => profile.has(x)).sort((a, b) => (usedIng.get(a) || 0) - (usedIng.get(b) || 0) || profile.get(b)! - profile.get(a)!)[0];
      if (g !== undefined) usedIng.set(g, (usedIng.get(g) || 0) + 1);
      const src = [...mine].find((m) => ings(m).includes(g));
      if (g !== undefined && src !== undefined) out.push(`${esc(p.idx.g[g][1])}入り（あなたの「${short(src)}」と同じ）`);
    }
    return out.slice(0, 3);
  };
  const cap = (n: number) =>
    `${p.idx.c[n][5] ? `<span class="block truncate">${esc(p.idx.c[n][5])}</span>` : ""}` +
    reasons(n).map((r) => `<span class="mt-0.5 flex gap-1"><span class="text-rose shrink-0" aria-hidden="true">✓</span><span class="min-w-0">${r}</span></span>`).join("");

  const who = concerns.length ? `${concerns.map((k) => k[1]).join("・")}が気になる` : "";
  const has = mine.size ? `${mine.size}品を使っている` : "";
  $("[data-foryou-title]").textContent = `${[who, has].filter(Boolean).join("、")}あなたへ`;
  $("[data-foryou-list]").innerHTML = picks.length
    ? picks.map((n) => tile(p, n, cap(n), d)).join("")
    : `<p class="col-span-full text-sm text-neutral-500">まだ候補がありません。使っているコスメや肌悩みを足すと出てきます。</p>`;
}

// ---- 商品を探して追加 ----
function nameScore(name: string, terms: string[]): number {
  const joined = terms.join("");
  if (name === joined) return 3;
  if (name.startsWith(joined)) return 2;
  return terms.every((t) => name.includes(t)) ? 1 : 0;
}
function renderSearch(p: Prepared, d: MyCosmeData) {
  const input = $<HTMLInputElement>("[data-search]");
  const out = $("[data-search-results]");
  $("[data-search-clear]").hidden = !input.value;
  const terms = splitTerms(input.value.trim());
  if (terms.join("").length < 2) {
    out.innerHTML = "";
    out.hidden = true;
    return;
  }
  const hits = p.idx.c
    .map((c, n) => ({ n, c }))
    .filter(({ n }) => terms.every((t) => p.hay[n].includes(t)))
    .map((x) => ({ ...x, s: nameScore(p.names[x.n], terms) }))
    .sort((a, b) => b.s - a.s || b.c[6] - a.c[6])
    .slice(0, 8);
  const mine = new Set(Object.keys(d[tab]).map((s) => resolve(p, s)));
  const other: ListKind = tab === "items" ? "wish" : "items";
  const inOther = new Set(Object.keys(d[other]).map((s) => resolve(p, s)));
  out.hidden = false;
  out.innerHTML = hits.length
    ? hits
        .map(({ n, c }) => {
          const src = img(c[4], 128);
          const on = mine.has(n);
          const label = on ? "登録済み" : inOther.has(n) ? `＋ ${LIST_LABEL[tab]}へ移す` : "＋ 追加";
          return `<li><button type="button" ${on ? "disabled" : `data-add="${esc(c[0])}" data-kind="${tab}"`} class="w-full flex items-center gap-3 px-3 py-2 text-left rounded-xl ${on ? "opacity-60" : "hover:bg-pink-100 cursor-pointer"}">
            <span class="w-10 h-10 shrink-0 rounded-lg product-well flex items-center justify-center overflow-hidden">${src ? `<img src="${esc(src)}" alt="" loading="lazy" class="w-full h-full object-contain p-0.5" onerror="this.remove()" />` : ""}</span>
            <span class="flex-1 min-w-0"><span class="block text-xs text-neutral-500 truncate">${esc(c[1])}${c[5] ? `・${esc(c[5])}` : ""}</span><span class="block text-sm truncate">${esc(c[3])}</span></span>
            <span class="shrink-0 text-xs ${on ? "text-neutral-400" : "text-rose"}">${label}</span>
          </button></li>`;
        })
        .join("")
    : `<li class="px-3 py-3 text-sm text-neutral-500">見つかりませんでした。ブランド名と商品名の一部（例：キャンメイク 下地）で探せます。動画で紹介されたコスメだけが載っています。</li>`;
}

// ---- おすすめ ----
const SWAP_LIMIT = 12, SWAP_PER_CAT = 3, NEW_LIMIT = 12, NEW_PER_CAT = 2, INF_LIMIT = 8, MIN_SUPPORT = 2;
const ING_WEIGHT = 0.5, ING_TOP = 2, ING_LIMIT = 6, CONCERN_WEIGHT = 0.5;
function renderRecommend(p: Prepared, d: MyCosmeData) {
  const mine = new Set<number>();
  for (const s of Object.keys(d.items)) {
    const n = resolve(p, s);
    if (n !== undefined) mine.add(n);
  }
  const box = $("[data-rec]");
  const popular = $("[data-popular]");
  if (mine.size === 0) {
    box.hidden = true;
    popular.hidden = false;
    // まだ何も登録していないとき：紹介の多いコスメから選べるようにする（c は動画数の多い順）
    $("[data-popular-list]").innerHTML = p.idx.c.slice(0, 12).map((_, n) => tile(p, n, `${p.idx.c[n][6]}本の動画で紹介`, d)).join("");
    return;
  }
  popular.hidden = true;
  box.hidden = false;

  const weight = new Map<number, number>(); // チャンネルの番号 → 登録したコスメのうち紹介した品数
  p.idx.ch.forEach((ch, k) => {
    let w = 0;
    for (const n of ch[3]) if (mine.has(n)) w++;
    if (w > 0) weight.set(k, w);
  });
  const score = new Map<number, number>();
  const support = new Map<number, number>();
  for (const [k, w] of weight) {
    for (const n of p.idx.ch[k][3]) {
      if (mine.has(n) || p.chCount[n] < 2) continue;
      score.set(n, (score.get(n) || 0) + w);
      support.set(n, (support.get(n) || 0) + 1);
    }
  }
  // 登録したコスメの成分（成分 → それが入っている登録品の数）
  const ings = (n: number) => p.idx.gi[n] || [];
  const profile = new Map<number, number>();
  for (const n of mine) for (const g of ings(n)) profile.set(g, (profile.get(g) || 0) + 1);
  const mass = [...profile.values()].reduce((a, b) => a + b, 0);
  const near = (n: number) => (mass ? ings(n).reduce((a, g) => a + (profile.get(g) || 0), 0) / mass : 0);
  // 選んだ肌悩みで紹介された商品 → 悩みの名前
  const byConcern = new Map<number, string[]>();
  for (const [, name, ns] of myConcerns(p, d)) for (const n of ns) byConcern.set(n, [...(byConcern.get(n) || []), name]);
  const ranked = [...score.entries()]
    .filter(([n]) => (support.get(n) || 0) >= MIN_SUPPORT)
    .map(([n, s]) => ({ n, s: (s / Math.sqrt(p.chCount[n])) * (1 + ING_WEIGHT * near(n)) * (byConcern.has(n) ? 1 + CONCERN_WEIGHT : 1) }))
    .sort((a, b) => b.s - a.s || p.idx.c[b.n][6] - p.idx.c[a.n][6]);

  const myCats = new Set([...mine].map((n) => p.idx.c[n][5]).filter(Boolean));
  const pick = (rows: typeof ranked, limit: number, perCat: number) => {
    const per = new Map<string, number>();
    const out: number[] = [];
    for (const { n } of rows) {
      const cat = p.idx.c[n][5];
      if ((per.get(cat) || 0) >= perCat) continue;
      per.set(cat, (per.get(cat) || 0) + 1);
      out.push(n);
      if (out.length >= limit) break;
    }
    return out;
  };
  const swap = pick(ranked.filter(({ n }) => myCats.has(p.idx.c[n][5])), SWAP_LIMIT, SWAP_PER_CAT);
  const fresh = pick(ranked.filter(({ n }) => p.idx.c[n][5] && !myCats.has(p.idx.c[n][5])), NEW_LIMIT, NEW_PER_CAT);
  const shared = (n: number) => ings(n).filter((g) => profile.has(g)).map((g) => p.idx.g[g][1]);
  const caption = (n: number) => {
    const same = shared(n);
    return `${p.idx.c[n][5] ? `<span class="block truncate">${esc(p.idx.c[n][5])}</span>` : ""}<span class="block">同じコスメを使う${support.get(n)}人が紹介</span>${byConcern.has(n) ? `<span class="block truncate">「${esc(byConcern.get(n)!.join("」「"))}」でも紹介</span>` : ""}${same.length ? `<span class="block truncate">同じ成分：${esc(same.join("・"))}</span>` : ""}`;
  };

  const fill = (sel: string, list: number[], none: string) => {
    const el = $(sel);
    el.innerHTML = list.length ? list.map((n) => tile(p, n, caption(n), d)).join("") : `<p class="col-span-full text-sm text-neutral-500">${none}</p>`;
  };
  fill("[data-rec-swap]", swap, "まだ候補がありません。コスメを登録すると出てきます。");
  fill("[data-rec-new]", fresh, "まだ候補がありません。コスメを登録すると出てきます。");

  // よく入っている成分から：登録品に多く入っている成分ごとに、その成分が全成分にある商品（2チャンネル以上）を出す（欄どうしで重ねない）。
  // 並びは上のおすすめの点数（無ければ紹介したチャンネル数）
  const ingBox = $("[data-rec-ing]");
  const top = [...profile.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, ING_TOP);
  ingBox.hidden = top.length === 0;
  const rankOf = new Map(ranked.map(({ n, s }) => [n, s]));
  const shown = new Set<number>(); // 前の成分の欄に出した商品は、次の欄には出さない
  $("[data-rec-ing-list]").innerHTML = top
    .map(([g, cnt]) => {
      const [slug, name] = p.idx.g[g];
      const list = Object.keys(p.idx.gi)
        .map(Number)
        .filter((n) => !mine.has(n) && !shown.has(n) && p.chCount[n] >= MIN_SUPPORT && ings(n).includes(g))
        .sort((a, b) => (rankOf.get(b) ?? -1) - (rankOf.get(a) ?? -1) || p.chCount[b] - p.chCount[a] || p.idx.c[b][6] - p.idx.c[a][6])
        .slice(0, ING_LIMIT);
      if (!list.length) return "";
      for (const n of list) shown.add(n);
      const cap = (n: number) => `${p.idx.c[n][5] ? `<span class="block truncate">${esc(p.idx.c[n][5])}</span>` : ""}<span class="block">${p.chCount[n]}人が紹介</span>`;
      return `<div class="min-w-0">
        <h3 class="text-sm font-medium">${esc(name)}<span class="ml-2 text-xs text-neutral-500">登録したコスメ${cnt}品の全成分に入っています</span></h3>
        <div class="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-8">${list.map((n) => tile(p, n, cap(n), d)).join("")}</div>
        <a href="${base}/ingredient/${esc(slug)}/" class="mt-4 inline-block text-xs text-rose hover:underline">${esc(name)}が入ったコスメをもっと見る →</a>
      </div>`;
    })
    .join("");

  // 好みが近いインフルエンサー：登録したコスメを多く紹介している順
  const infs = [...weight.entries()].sort((a, b) => b[1] - a[1] || p.idx.ch[b[0]][3].length - p.idx.ch[a[0]][3].length).slice(0, INF_LIMIT);
  $("[data-rec-inf]").innerHTML = infs
    .map(([k, w]) => {
      const [id, title, icon] = p.idx.ch[k];
      const pic = icon
        ? `<img referrerpolicy="no-referrer" src="${esc(icon)}" alt="" width="44" height="44" class="w-11 h-11 rounded-full shrink-0" loading="lazy" data-name="${esc(title)}" />`
        : `<span class="w-11 h-11 rounded-full shrink-0 bg-ink/5"></span>`;
      return `<li class="min-w-0"><a href="${base}/influencer/${esc(id)}/" class="flex items-center gap-3 py-2.5 group min-w-0">${pic}<span class="min-w-0"><span class="block text-sm truncate group-hover:text-rose transition-colors">${esc(title)}</span><span class="block text-xs text-neutral-500">あなたのコスメ${w}品を紹介</span></span></a></li>`;
    })
    .join("");
}

// ---- 書き出し・読み込み・すべて消す ----
function setStatus(msg: string, error = false) {
  const el = $("[data-status]");
  el.textContent = msg;
  el.classList.toggle("text-rose", error);
  // 上部の帯にも同じ文を出す（上のボタンで同期したとき、下の欄まで見に行かなくて済むように。259章）
  const top = $("[data-status-top]");
  top.textContent = msg;
  top.hidden = !msg;
  top.classList.toggle("text-rose", error);
}
function downloadFile() {
  const blob = new Blob([exportText(load())], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const t = new Date();
  a.download = `osorocosme-my-cosme-${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, "0")}${String(t.getDate()).padStart(2, "0")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  setStatus("ファイルに書き出しました。別の端末の、このページの「ファイルから読み込む」で読み込めます。");
  track("export");
}
async function importFile(file: File) {
  try {
    const got = sanitize(JSON.parse(await file.text()));
    if (!got) throw new Error();
    const merged = merge(load(), got);
    save(merged);
    setStatus(`読み込みました（使っている${Object.keys(merged.items).length}品・気になる${Object.keys(merged.wish).length}品）。`);
    track("import");
    afterLocalChange();
  } catch {
    setStatus("このファイルは読み込めませんでした。OsoroCosmeで書き出したファイルを選んでください。", true);
  }
}

// ---- Googleドライブ ----
function renderDrive() {
  const box = root.querySelector<HTMLElement>("[data-drive]");
  if (!box) return;
  const on = isConnected();
  box.querySelector<HTMLElement>("[data-drive-on]")!.hidden = !on;
  box.querySelector<HTMLElement>("[data-drive-off]")!.hidden = on;
  // ページ上部の案内
  const top = root.querySelector<HTMLElement>("[data-drive-top]");
  if (top) top.textContent = on ? "同期する" : "Googleドライブと同期";
  const topOff = root.querySelector<HTMLElement>("[data-drive-top-off]");
  if (topOff) topOff.hidden = !on;
  $("[data-save-note]").textContent = on
    ? "この端末はGoogleドライブと同期しています。ほかの端末の変更を取り込むときは「同期する」を、やめるときは「同期をやめる」を押してください。"
    : "一覧はこの端末のブラウザにだけ保存されます。ほかの端末でも使うときや控えを取るときは、Googleドライブとの同期かファイルへの書き出しをどうぞ。";
}
async function driveSync() {
  setStatus("Googleドライブと同期しています…");
  try {
    const n = await sync(clientId);
    setStatus(`Googleドライブと同期しました（使っている${n.items}品・気になる${n.wish}品）。ほかの端末でも、このページの「同期する」で同じ一覧になります。`);
    track("drive_sync");
  } catch (e) {
    setStatus((e as Error).message, true);
  }
  renderDrive();
}
async function driveDisconnect(erase: boolean) {
  try {
    await disconnect(clientId, erase);
    setStatus(erase ? "Googleドライブの保存を消して、同期をやめました。この端末の一覧は残っています。" : "Googleドライブとの同期をやめました。ドライブの保存とこの端末の一覧は残っています。");
  } catch (e) {
    setStatus((e as Error).message, true);
  }
  renderDrive();
}
let pushTimer: number | undefined;
function afterLocalChange() {
  // つないでいる間は、変えた一覧をドライブにも書く（続けて変えたときは最後の1回だけ）
  clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    pushIfConnected().catch((e) => setStatus((e as Error).message, true));
  }, 1500);
}

// ---- 起動 ----
async function main() {
  let p: Prepared;
  try {
    p = await prepare();
  } catch {
    $("[data-loading]").textContent = "データを読み込めませんでした。時間をおいて、もう一度開いてください。";
    return;
  }
  $("[data-loading]").remove();
  $("[data-ready]").hidden = false;
  const renderAll = (d: MyCosmeData) => {
    renderList(p, d);
    renderConcernChips(p, d);
    renderForYou(p, d);
    renderConcernRec(p, d);
    renderRecommend(p, d);
    renderSearch(p, d);
  };
  renderAll(load());
  renderDrive();
  onChange(renderAll);

  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const nameOf = (slug: string) => {
      const n = p.bySlug.get(slug);
      return n !== undefined ? `${p.idx.c[n][1]} ${p.idx.c[n][3]}` : undefined;
    };
    const put = (slug: string, kind: ListKind) => {
      if (!add(slug, nameOf(slug), kind)) setStatus("このブラウザでは保存できませんでした（プライベートブラウズでは保存できないことがあります）。", true);
      track(kind === "wish" ? "wish_add" : "add");
      afterLocalChange();
    };
    const cBtn = t.closest<HTMLElement>("[data-concern]");
    if (cBtn) {
      const slug = cBtn.dataset.concern!;
      const on = load().concerns[slug];
      if (on) remove(slug, "concerns");
      else add(slug, undefined, "concerns");
      track(on ? "concern_remove" : "concern_add");
      afterLocalChange();
      return;
    }
    const tabBtn = t.closest<HTMLElement>("[data-tab]");
    if (tabBtn) {
      tab = tabBtn.dataset.tab as ListKind;
      renderAll(load());
      return;
    }
    const addBtn = t.closest<HTMLElement>("[data-add]");
    if (addBtn) {
      // 選んだら検索の文字と候補を閉じる（追加した品は左の一覧に出る。264章）
      clearSearch(false);
      return put(addBtn.dataset.add!, (addBtn.dataset.kind as ListKind) || "items");
    }
    if (t.closest("[data-search-clear]")) return clearSearch(true);
    const tog = t.closest<HTMLElement>("[data-toggle]");
    if (tog) {
      const kind = tog.dataset.toggle as ListKind;
      const slug = tog.dataset.slug!;
      if (!has(slug, kind)) return put(slug, kind);
      remove(slug, kind);
      track(kind === "wish" ? "wish_remove" : "remove");
      afterLocalChange();
      return;
    }
    const mv = t.closest<HTMLElement>("[data-move]");
    if (mv) return put(mv.dataset.move!, "items");
    const rm = t.closest<HTMLElement>("[data-remove]");
    if (rm) {
      const kind = (rm.dataset.kind as ListKind) || "items";
      remove(rm.dataset.remove!, kind);
      track(kind === "wish" ? "wish_remove" : "remove");
      afterLocalChange();
      return;
    }
    const act = t.closest<HTMLElement>("[data-action]")?.dataset.action;
    if (act === "export") downloadFile();
    else if (act === "import") $<HTMLInputElement>("[data-import-file]").click();
    else if (act === "clear") {
      const cur = load();
      if (!Object.keys(cur.items).length && !Object.keys(cur.wish).length && !Object.keys(cur.concerns).length) return;
      // 押し間違いで消えないよう、2回押したときだけ消す（確認のダイアログは出さない）
      const btn = t.closest<HTMLElement>("[data-action]")!;
      if (!btn.dataset.armed) {
        btn.dataset.armed = "1";
        const label = btn.textContent;
        btn.textContent = "もう一度押すと、すべて消します";
        setTimeout(() => { delete btn.dataset.armed; btn.textContent = label; }, 4000);
        return;
      }
      const d = load();
      const now = Date.now();
      for (const s of Object.keys(d.items)) d.removed[s] = now;
      for (const s of Object.keys(d.wish)) d.wishRemoved[s] = now;
      for (const s of Object.keys(d.concerns)) d.concernsRemoved[s] = now;
      d.items = {};
      d.wish = {};
      d.concerns = {};
      save(d);
      setStatus("一覧（使っている・気になる・肌悩み）を空にしました。");
      afterLocalChange();
    } else if (act === "drive-sync" || act === "drive-start") {
      // まだつないでいない端末でも、押したらすぐGoogleの画面を開く（ボタンを押した処理の中から呼ぶ：ポップアップが止められないように）。
      // 259章では説明へスクロールさせていたが、上部に「同期について詳細を確認する↓」が別にあり、役割が重なっていた（264章）
      if (!isConnected()) track("drive_start");
      driveSync();
    }
    else if (act === "drive-off") driveDisconnect(false);
    else if (act === "drive-erase") driveDisconnect(true);
  });
  $<HTMLInputElement>("[data-search]").addEventListener("input", () => renderSearch(p, load()));
  /** 検索の文字を消して候補を閉じる（focus＝続けて入力できるよう入力欄に戻す） */
  function clearSearch(focus: boolean) {
    const input = $<HTMLInputElement>("[data-search]");
    input.value = "";
    renderSearch(p, load());
    if (focus) input.focus();
  }
  $<HTMLInputElement>("[data-import-file]").addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (f) importFile(f);
    input.value = "";
  });
}
main();
