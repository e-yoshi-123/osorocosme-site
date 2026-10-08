import { norm, splitTerms } from "../lib/search-norm";

/** 検索欄の候補：data-suggest を付けたフォームの入力欄で、2文字目から、ブランド・インフルエンサー・コスメの名前の候補と、
 * 肌悩み・成分・特集・カテゴリのランキングのページ（247章）を出す。何も入力せずに触れたときは「探し方」のパネル（data-explore）を出す。
 * 候補の索引（search-suggest.json）は、入力欄に初めて触れたときに読む。
 * ↑↓で選び、Enterでそのページへ（選んでいなければ普通に検索）、Escで閉じる。 */

type BrandRow = [string, string, string, number];
type InfRow = [string, string, string, number];
type CosRow = [string, string, number, string, number, string];
type ExploreRow = [string, string, string, string, number];
interface SuggestIndex { b: BrandRow[]; i: InfRow[]; c: CosRow[]; x?: ExploreRow[] }
interface Prepared {
  idx: SuggestIndex;
  brandNames: string[][];
  brandHay: string[];
  infNames: string[];
  cosNames: string[];
  cosHay: string[];
  exNames: string[][];
}
interface Item { kind: string; href: string; label: string; sub: string; icon?: string }

const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL.slice(0, -1) : import.meta.env.BASE_URL;
const MIN_CHARS = 2;
const LIMIT = { brand: 4, influencer: 3, cosmetic: 6, explore: 4 };

let loading: Promise<Prepared> | undefined;
function load(): Promise<Prepared> {
  loading ??= fetch(`${base}/search-suggest.json`)
    .then((r) => r.json())
    .then((idx: SuggestIndex) => {
      const brandNames = idx.b.map((b) => [norm(b[1]), ...b[2].split(" ").map(norm)].filter(Boolean));
      const brandHay = brandNames.map((ns) => ns.join("|"));
      const cosNames = idx.c.map((c) => norm(c[3]));
      return {
        idx,
        brandNames,
        brandHay,
        infNames: idx.i.map((i) => norm(i[1])),
        cosNames,
        // カテゴリでも引ける（「キャンメイク 下地」）。並びは商品名との一致を優先する
        cosHay: idx.c.map((c, n) => `${norm(c[1])}|${c[2] >= 0 ? brandHay[c[2]] : ""}|${cosNames[n]}|${c[5].split(" ").map(norm).join("|")}`),
        exNames: (idx.x || []).map((x) => x[3].split(" ").map(norm).filter(Boolean)),
      };
    })
    .catch((e) => {
      loading = undefined; // 次に触れたときに読み直す
      throw e;
    });
  return loading;
}

/** 名前との一致の強さ（完全一致 3、前方一致 2、部分一致 1、なし 0）。検索結果のページと同じ考え方 */
function nameScore(names: string[], terms: string[]): number {
  const joined = terms.join("");
  let best = 0;
  for (const n of names) {
    if (n === joined) return 3;
    if (n.startsWith(joined)) best = Math.max(best, 2);
    else if (terms.every((t) => n.includes(t))) best = Math.max(best, 1);
  }
  return best;
}

function suggest(p: Prepared, terms: string[]): Item[] {
  const hits = (hay: string) => terms.every((t) => hay.includes(t));
  const top = <T,>(rows: T[], score: (n: number) => number, hay: (n: number) => string, count: (r: T) => number, k: number) =>
    rows
      .map((r, n) => ({ r, n, s: 0 }))
      .filter((x) => hits(hay(x.n)))
      .map((x) => ({ ...x, s: score(x.n) }))
      .sort((x, y) => y.s - x.s || count(y.r) - count(x.r))
      .slice(0, k);

  const brands = top(p.idx.b, (n) => nameScore(p.brandNames[n], terms), (n) => p.brandHay[n], (b) => b[3], LIMIT.brand);
  const infs = top(p.idx.i, (n) => nameScore([p.infNames[n]], terms), (n) => p.infNames[n], (i) => i[3], LIMIT.influencer);
  // コスメは商品名に当たるものを先に（ブランド名だけで当たるものは、ブランドの候補があれば十分なため）
  const cos = top(p.idx.c, (n) => nameScore([p.cosNames[n]], terms), (n) => p.cosHay[n], (c) => c[4], LIMIT.cosmetic);

  // 肌悩み・成分・特集・ランキングのページ。語の一部に当たるもの（「ビタミン」→ビタミンC）も拾い、当たり方の強い順・品数の多い順
  const ex = top(p.idx.x || [], (n) => nameScore(p.exNames[n], terms), (n) => p.exNames[n].join("|"), (x) => x[4], LIMIT.explore);
  const exItems = ex.map(({ r: x }) => ({
    kind: "探し方",
    href: `${base}${x[2]}`,
    label: x[0] === "ランキング" ? `${x[1]}のランキング` : x[0] === "肌悩み" ? `肌悩み：${x[1]}` : x[0] === "成分" ? `成分：${x[1]}が入ったスキンケア` : `特集：${x[1]}`,
    sub: `${x[4]}品`,
  }));
  const groups: { s: number; items: Item[] }[] = [
    // 探し方のページは、名前にほぼそのまま当たったとき（前方一致以上）は先頭に出す
    { s: (ex[0]?.s ?? 0) >= 2 ? 4 : ex[0]?.s ?? 0, items: exItems },
    { s: brands[0]?.s ?? 0, items: brands.map(({ r: b }) => ({ kind: "ブランド", href: `${base}/brand/${b[0]}/`, label: b[1], sub: `動画 ${b[3]}本` })) },
    { s: infs[0]?.s ?? 0, items: infs.map(({ r: i }) => ({ kind: "インフルエンサー", href: `${base}/influencer/${i[0]}/`, label: i[1], sub: `動画 ${i[3]}本`, icon: i[2] })) },
    { s: cos[0]?.s ?? 0, items: cos.map(({ r: c }) => ({ kind: "コスメ", href: `${base}/cosmetics/${c[0]}/`, label: c[3], sub: c[1] })) },
  ];
  // 名前で強く当たった種類を先に（検索結果のページと同じ）
  return groups.sort((x, y) => y.s - x.s).flatMap((g) => g.items);
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

let uid = 0;
function attach(form: HTMLFormElement) {
  const input = form.querySelector<HTMLInputElement>('input[name="q"]');
  if (!input) return;
  const id = `suggest-${++uid}`;
  // 候補は入力欄を囲む枠の真下に、同じ幅で出す。スマホでは検索欄がロゴの横で狭いので、ヘッダーの下に画面の幅いっぱいで出す（247章）
  const box = input.parentElement!;
  box.style.position = "relative";
  // 何も入力せずに触れたときの「探し方」のパネル（ExplorePanel.astro。HTMLに入っている）
  const explore = form.querySelector<HTMLElement>("[data-explore]");
  if (explore && explore.parentElement !== box) box.appendChild(explore);
  explore?.addEventListener("mousedown", (e) => e.preventDefault());
  const showExplore = (on: boolean) => {
    if (explore) explore.hidden = !on;
  };
  const list = document.createElement("div");
  list.id = id;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "検索の候補");
  list.hidden = true;
  list.className =
    "absolute left-0 right-0 top-full mt-2 max-md:fixed max-md:inset-x-3 max-md:top-[3.75rem] max-md:mt-0 z-50 max-h-[min(70vh,28rem)] overflow-y-auto overscroll-contain rounded-2xl bg-white text-ink text-left shadow-[0_12px_40px_-12px_rgba(0,0,0,0.25)] ring-1 ring-ink/10 py-2";
  box.appendChild(list);
  // 候補を押しても入力欄から焦点を外さない（Safariはリンクに焦点が移らず、先に閉じて押せなくなるため）
  list.addEventListener("mousedown", (e) => e.preventDefault());
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", id);
  input.setAttribute("aria-expanded", "false");
  input.autocomplete = "off";

  let items: Item[] = [];
  let active = -1;
  let seq = 0;

  const close = () => {
    showExplore(false);
    list.hidden = true;
    active = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };
  const setActive = (n: number) => {
    active = n;
    list.querySelectorAll<HTMLElement>("[role=option]").forEach((el, k) => {
      const on = k === n;
      el.setAttribute("aria-selected", String(on));
      el.classList.toggle("bg-pink-100", on);
      if (on) el.scrollIntoView({ block: "nearest" });
    });
    if (n >= 0) input.setAttribute("aria-activedescendant", `${id}-${n}`);
    else input.removeAttribute("aria-activedescendant");
  };

  const render = (q: string) => {
    let lastKind = "";
    const rows = items.map((it, n) => {
      const head = it.kind !== lastKind ? `<p class="px-4 pt-2 pb-1 label-caps text-[10px] text-neutral-400" aria-hidden="true">${it.kind}</p>` : "";
      lastKind = it.kind;
      const icon = it.icon
        ? `<img referrerpolicy="no-referrer" src="${esc(it.icon)}" alt="" width="24" height="24" class="w-6 h-6 rounded-full shrink-0" loading="lazy" />`
        : "";
      return `${head}<a id="${id}-${n}" role="option" aria-selected="false" href="${it.href}" class="flex items-center gap-2.5 px-4 py-2 min-w-0 hover:bg-pink-100 transition-colors">${icon}<span class="min-w-0 flex-1"><span class="block text-sm truncate">${esc(it.label)}</span><span class="block text-xs text-neutral-500 truncate">${esc(it.sub)}</span></span></a>`;
    });
    const all = `<a href="${base}/search-result?q=${encodeURIComponent(q)}" class="flex items-center gap-2 mt-1 px-4 pt-3 pb-2 border-t border-ink/10 text-sm text-rose hover:underline">「${esc(q)}」の検索結果をすべて見る<span aria-hidden="true">→</span></a>`;
    list.innerHTML = rows.join("") + all;
    showExplore(false);
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    active = -1;
  };

  const update = async () => {
    const q = input.value.trim();
    const terms = splitTerms(q);
    const my = ++seq;
    if (terms.join("").length < MIN_CHARS) {
      close();
      if (!q) showExplore(true); // 空欄に戻したら探し方を出す
      return;
    }
    let p: Prepared;
    try {
      p = await load();
    } catch {
      return close();
    }
    if (my !== seq) return; // 読み込み中に入力が進んだ
    items = suggest(p, terms);
    render(q);
  };

  input.addEventListener("focus", () => {
    load().catch(() => {});
    if (input.value.trim()) update();
    else showExplore(true);
  }, { passive: true });
  input.addEventListener("input", update);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && explore && !explore.hidden) return showExplore(false);
    if (e.isComposing || list.hidden) return; // 日本語の変換中のEnter・矢印は変換に使う
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(active + 1 >= items.length ? -1 : active + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(active - 1 < -1 ? items.length - 1 : active - 1);
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      location.href = items[active].href;
    } else if (e.key === "Escape") {
      close();
    }
  });
  // 欄の外を押したら閉じる（候補を押したときは、リンクの移動が先に起きるよう pointerdown で判定）
  document.addEventListener("pointerdown", (e) => {
    if (!form.contains(e.target as Node)) close();
  });
  form.addEventListener("focusout", (e) => {
    if (!form.contains(e.relatedTarget as Node | null)) close();
  });
}

document.querySelectorAll<HTMLFormElement>("form[data-suggest]").forEach(attach);
