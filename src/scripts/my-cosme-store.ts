/** マイコスメ（今使っているコスメの一覧。5-4）の保存。
 * 保存先はこの端末のブラウザ（localStorage）だけで、OsoroCosmeには何も送らない（決定事項：運営者のデータベースに持たない）。
 * 端末を移すときは、ファイルへの書き出し・読み込みか、利用者本人のGoogleドライブ（scripts/my-cosme-drive.ts）を使う。
 * 2か所の一覧を合わせる（読み込み・同期）とき、消した商品が戻らないよう、消した時刻も持つ（removed）。 */

export interface MyCosmeData {
  v: 1;
  /** 登録した商品：slug → 登録した時刻（ミリ秒）と、表示用の名前（ブランド＋商品名。データから消えた商品の表示に使う） */
  items: Record<string, { t: number; n?: string }>;
  /** 消した商品：slug → 消した時刻 */
  removed: Record<string, number>;
}

const KEY = "osorocosme.mycosme";
const EVENT = "mycosme:change";
/** 消した記録は新しいものからこの件数まで持つ（一覧を合わせるときに、古い端末から戻らないようにするため） */
const REMOVED_KEEP = 500;

const empty = (): MyCosmeData => ({ v: 1, items: {}, removed: {} });

/** 形の崩れたデータ（手で書き換えたファイル等）は、読める項目だけを拾う */
export function sanitize(raw: unknown): MyCosmeData | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<MyCosmeData>;
  if (!r.items || typeof r.items !== "object") return null;
  const out = empty();
  for (const [slug, it] of Object.entries(r.items)) {
    if (!/^brand-\d+-name-\d+$/.test(slug) || !it || typeof it.t !== "number") continue;
    out.items[slug] = typeof it.n === "string" ? { t: it.t, n: it.n.slice(0, 200) } : { t: it.t };
  }
  for (const [slug, t] of Object.entries(r.removed || {})) {
    if (/^brand-\d+-name-\d+$/.test(slug) && typeof t === "number") out.removed[slug] = t;
  }
  return out;
}

export function load(): MyCosmeData {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY) || "null")) || empty();
  } catch {
    return empty();
  }
}

function trimRemoved(d: MyCosmeData) {
  const list = Object.entries(d.removed);
  if (list.length <= REMOVED_KEEP) return;
  d.removed = Object.fromEntries(list.sort((a, b) => b[1] - a[1]).slice(0, REMOVED_KEEP));
}

/** 保存して、同じページの表示（ヘッダーの件数・ボタン）に知らせる。保存できない（プライベートブラウズ等）ときは false */
export function save(d: MyCosmeData): boolean {
  trimRemoved(d);
  let ok = true;
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    ok = false;
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: d }));
  return ok;
}

export function has(slug: string): boolean {
  return !!load().items[slug];
}

export function add(slug: string, name?: string): boolean {
  const d = load();
  if (d.items[slug]) return true;
  d.items[slug] = name ? { t: Date.now(), n: name } : { t: Date.now() };
  delete d.removed[slug];
  return save(d);
}

export function remove(slug: string): boolean {
  const d = load();
  if (!d.items[slug]) return true;
  delete d.items[slug];
  d.removed[slug] = Date.now();
  return save(d);
}

/** 2つの一覧を合わせる：商品ごとに、登録と削除の新しい方を採る */
export function merge(a: MyCosmeData, b: MyCosmeData): MyCosmeData {
  const out = empty();
  const slugs = new Set([...Object.keys(a.items), ...Object.keys(b.items), ...Object.keys(a.removed), ...Object.keys(b.removed)]);
  for (const s of slugs) {
    const ia = a.items[s], ib = b.items[s];
    const item = !ia ? ib : !ib ? ia : ia.t >= ib.t ? { ...ia, n: ia.n || ib.n } : { ...ib, n: ib.n || ia.n };
    const rm = Math.max(a.removed[s] || 0, b.removed[s] || 0);
    if (item && item.t > rm) out.items[s] = item;
    else if (rm) out.removed[s] = rm;
  }
  trimRemoved(out);
  return out;
}

/** 同じ中身か（同期のあと、書き戻す必要があるかの判定） */
export function same(a: MyCosmeData, b: MyCosmeData): boolean {
  const key = (d: MyCosmeData) =>
    JSON.stringify([Object.entries(d.items).map(([s, i]) => [s, i.t]).sort(), Object.entries(d.removed).sort()]);
  return key(a) === key(b);
}

/** 書き出すファイルの中身（読み込みで同じ形に戻せる。名前は人が見て分かるように付ける） */
export function exportText(d: MyCosmeData): string {
  return JSON.stringify({ app: "OsoroCosme", kind: "my-cosme", exported_at: new Date().toISOString(), ...d }, null, 1);
}

export function onChange(fn: (d: MyCosmeData) => void) {
  window.addEventListener(EVENT, (e) => fn((e as CustomEvent<MyCosmeData>).detail));
  // ほかのタブでの変更（storage イベントは、変えたタブ以外に届く）
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) fn(load());
  });
}

export function count(): number {
  return Object.keys(load().items).length;
}
