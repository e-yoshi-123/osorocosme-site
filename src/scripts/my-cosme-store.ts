/** マイコスメ（今使っているコスメの一覧と、気になるコスメの一覧。5-4）の保存。
 * 保存先はこの端末のブラウザ（localStorage）だけで、OsoroCosmeには何も送らない（決定事項：運営者のデータベースに持たない）。
 * 端末を移すときは、ファイルへの書き出し・読み込みか、利用者本人のGoogleドライブ（scripts/my-cosme-drive.ts）を使う。
 * 2か所の一覧を合わせる（読み込み・同期）とき、消した商品が戻らないよう、消した時刻も持つ（removed）。
 * 「気になる」（wish・wishRemoved）は259章で足した。「使っている」とは別の一覧で、同じ商品は片方にだけ入る（入れたほうに移る）。
 * 肌悩み（concerns・concernsRemoved。キーは /concern/<slug>/ の slug）も259章で足した。合わせ方は商品と同じ。
 * パーソナルカラー（pc・pcRemoved。キーは「イエベ春」など。1つだけ選ぶのはページ側で守る）と肌質（skin・skinRemoved。複数可）は313章で足した。
 * 商品の「持っている色・気になる色」（Item の c＝公式の色の表示名、ct＝色を変えた時刻）は363章で足した。 */

export interface MyCosmeData {
  v: 1;
  /** 登録した商品：slug → 登録した時刻（ミリ秒）と、表示用の名前（ブランド＋商品名。データから消えた商品の表示に使う） */
  items: Record<string, Item>;
  /** 消した商品：slug → 消した時刻 */
  removed: Record<string, number>;
  /** 気になる商品（形は items と同じ） */
  wish: Record<string, Item>;
  /** 「気になる」から消した商品 */
  wishRemoved: Record<string, number>;
  /** 選んだ肌悩み：slug → 選んだ時刻 */
  concerns: Record<string, Item>;
  /** 選ぶのをやめた肌悩み */
  concernsRemoved: Record<string, number>;
  /** 選んだパーソナルカラー（/personal-color/ の slug） */
  pc: Record<string, Item>;
  pcRemoved: Record<string, number>;
  /** 選んだ肌質（/skin-type/ の slug） */
  skin: Record<string, Item>;
  skinRemoved: Record<string, number>;
}
export type Item = { t: number; n?: string; /** 選んだ色（公式の色の表示名。商品ページの色の一覧と同じ） */ c?: string[]; /** 色を選び直した時刻 */ ct?: number };
/** どちらの一覧か：items＝使っている、wish＝気になる */
export type ListKind = "items" | "wish";
/** 保存する一覧の種類（商品の2つと、肌悩み） */
export type Kind = ListKind | "concerns" | "pc" | "skin";
const KINDS = ["items", "wish", "concerns", "pc", "skin"] as const;
const REMOVED_OF = { items: "removed", wish: "wishRemoved", concerns: "concernsRemoved", pc: "pcRemoved", skin: "skinRemoved" } as const;
const OTHER: Partial<Record<Kind, ListKind>> = { items: "wish", wish: "items" };

const KEY = "osorocosme.mycosme";
const EVENT = "mycosme:change";
/** 消した記録は新しいものからこの件数まで持つ（一覧を合わせるときに、古い端末から戻らないようにするため） */
const REMOVED_KEEP = 500;

const empty = (): MyCosmeData => ({ v: 1, items: {}, removed: {}, wish: {}, wishRemoved: {}, concerns: {}, concernsRemoved: {}, pc: {}, pcRemoved: {}, skin: {}, skinRemoved: {} });
const PRODUCT_SLUG = /^brand-\d+-name-\d+$/;
const KEY_OK: Record<Kind, RegExp> = { items: PRODUCT_SLUG, wish: PRODUCT_SLUG, concerns: /^[a-z][a-z-]{0,39}$/, pc: /^(イエベ|ブルベ)(春|夏|秋|冬)?$/, skin: /^(乾燥肌|敏感肌|インナードライ|混合肌|脂性肌|普通肌)$/ };

/** 形の崩れたデータ（手で書き換えたファイル等）は、読める項目だけを拾う */
export function sanitize(raw: unknown): MyCosmeData | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<MyCosmeData>;
  if (!r.items || typeof r.items !== "object") return null;
  const out = empty();
  for (const kind of KINDS) {
    const SLUG = KEY_OK[kind];
    const items = r[kind];
    if (items && typeof items === "object") {
      for (const [slug, it] of Object.entries(items)) {
        if (!SLUG.test(slug) || !it || typeof it.t !== "number") continue;
        const item: Item = typeof it.n === "string" ? { t: it.t, n: it.n.slice(0, 200) } : { t: it.t };
        if (Array.isArray(it.c)) {
          const c = it.c.filter((x): x is string => typeof x === "string" && x.length > 0).map((x) => x.slice(0, 80)).slice(0, 60);
          if (c.length) item.c = c;
          if (typeof it.ct === "number") item.ct = it.ct;
        }
        out[kind][slug] = item;
      }
    }
    const rm = r[REMOVED_OF[kind]];
    for (const [slug, t] of Object.entries(rm && typeof rm === "object" ? rm : {})) {
      if (SLUG.test(slug) && typeof t === "number") out[REMOVED_OF[kind]][slug] = t;
    }
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
  for (const key of Object.values(REMOVED_OF)) {
    const list = Object.entries(d[key]);
    if (list.length > REMOVED_KEEP) d[key] = Object.fromEntries(list.sort((a, b) => b[1] - a[1]).slice(0, REMOVED_KEEP));
  }
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

export function has(slug: string, kind: Kind = "items"): boolean {
  return !!load()[kind][slug];
}

/** 一覧に入れる。もう片方の一覧に入っていれば、そちらからは外す（同じ商品は片方にだけ入る） */
export function add(slug: string, name?: string, kind: Kind = "items"): boolean {
  const d = load();
  if (d[kind][slug]) return true;
  const now = Date.now();
  const other = OTHER[kind];
  let colors: Pick<Item, "c" | "ct"> = {};
  if (other && d[other][slug]) {
    name ||= d[other][slug].n;
    const o = d[other][slug];
    if (o.c?.length) colors = { c: o.c, ct: o.ct ?? now };  // 「気になる」から「使っている」へ移すときは、選んだ色も移す
    delete d[other][slug];
    d[REMOVED_OF[other]][slug] = now;
  }
  d[kind][slug] = { t: now, ...(name ? { n: name } : {}), ...colors };
  delete d[REMOVED_OF[kind]][slug];
  return save(d);
}

/** 登録した商品の、選んだ色（無ければ空） */
export function colorsOf(slug: string, kind: ListKind): string[] {
  return load()[kind][slug]?.c || [];
}
/** 登録した商品の色を選び直す（登録していない商品には何もしない） */
export function setColors(slug: string, kind: ListKind, labels: string[]): boolean {
  const d = load();
  const it = d[kind][slug];
  if (!it) return false;
  const c = [...new Set(labels)].slice(0, 60);
  if (c.length) it.c = c; else delete it.c;
  it.ct = Date.now();
  return save(d);
}

/** 統合した商品（古い slug → 寄せ先の slug）に古い番号で登録していれば、寄せ先の番号に移す（選んだ色も移す。363章）。
 * 古い番号には消した記録を付ける（ドライブとの同期で、ほかの端末から古い番号が戻らないように）。両方にあれば新しく登録したほうを残す。
 * 移したら保存して true（何も無ければ保存しない） */
export function renameSlugs(map: Record<string, string>): boolean {
  const d = load();
  let changed = false;
  const now = Date.now();
  for (const kind of ["items", "wish"] as const) {
    for (const [from, it] of Object.entries(d[kind])) {
      const to = map[from];
      if (!to || to === from) continue;
      const cur = d[kind][to];
      if (!cur || it.t > cur.t) d[kind][to] = { ...it, ...(cur?.c?.length && (cur.ct || 0) > (it.ct || 0) ? { c: cur.c, ct: cur.ct } : {}) };
      delete d[REMOVED_OF[kind]][to];
      delete d[kind][from];
      d[REMOVED_OF[kind]][from] = now;
      changed = true;
    }
  }
  // 「使っている」と「気になる」の両方に入ったら、新しく入れたほうを残す（同じ商品は片方にだけ）
  for (const s of Object.keys(d.wish)) {
    if (!d.items[s]) continue;
    const drop = d.items[s].t >= d.wish[s].t ? "wish" : "items";
    delete d[drop][s];
    d[REMOVED_OF[drop]][s] = now;
  }
  return changed ? save(d) : false;
}

export function remove(slug: string, kind: Kind = "items"): boolean {
  const d = load();
  if (!d[kind][slug]) return true;
  delete d[kind][slug];
  d[REMOVED_OF[kind]][slug] = Date.now();
  return save(d);
}

/** 2つの一覧を合わせる：一覧ごと・商品ごとに、登録と削除の新しい方を採る */
export function merge(a: MyCosmeData, b: MyCosmeData): MyCosmeData {
  const out = empty();
  for (const kind of KINDS) {
    const rmKey = REMOVED_OF[kind];
    const slugs = new Set([...Object.keys(a[kind]), ...Object.keys(b[kind]), ...Object.keys(a[rmKey]), ...Object.keys(b[rmKey])]);
    for (const s of slugs) {
      const ia = a[kind][s], ib = b[kind][s];
      let item = !ia ? ib : !ib ? ia : ia.t >= ib.t ? { ...ia, n: ia.n || ib.n } : { ...ib, n: ib.n || ia.n };
      // 選んだ色は、選び直した時刻（ct）の新しいほうを採る
      if (ia && ib && item) {
        const src = (ia.ct || 0) >= (ib.ct || 0) ? ia : ib;
        item = { ...item };
        if (src.c?.length) item.c = src.c; else delete item.c;
        if (src.ct) item.ct = src.ct; else delete item.ct;
      }
      const rm = Math.max(a[rmKey][s] || 0, b[rmKey][s] || 0);
      if (item && item.t > rm) out[kind][s] = item;
      else if (rm) out[rmKey][s] = rm;
    }
  }
  // 移したときの消した記録は同じ時刻で付くので、ふつうは両方に残らない。古い版のデータ等で両方に残ったら、新しく入れた方を採る
  for (const s of Object.keys(out.wish)) {
    if (!out.items[s]) continue;
    const drop = out.items[s].t >= out.wish[s].t ? "wish" : "items";
    out[REMOVED_OF[drop]][s] = out[drop][s].t;
    delete out[drop][s];
  }
  trimRemoved(out);
  return out;
}

/** 同じ中身か（同期のあと、書き戻す必要があるかの判定） */
export function same(a: MyCosmeData, b: MyCosmeData): boolean {
  const key = (d: MyCosmeData) =>
    JSON.stringify(
      KINDS.map((k) => [Object.entries(d[k]).map(([s, i]) => [s, i.t, i.ct || 0, (i.c || []).join("\u0001")]).sort(), Object.entries(d[REMOVED_OF[k]]).sort()]),
    );
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

export function count(kind?: ListKind): number {
  const d = load();
  return kind ? Object.keys(d[kind]).length : Object.keys(d.items).length + Object.keys(d.wish).length;
}
