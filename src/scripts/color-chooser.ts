/** マイコスメの「持っている色・気になる色」を選ぶ部品（商品ページとマイコスメのページで使う。363章）。
 * 色の候補は [公式の色の表示名, #RRGGBB か空]。選ぶたびに my-cosme-store の setColors で保存する（この端末のブラウザだけ）。
 * 見た目はこの部品の中のCSS（cc-）で書く（スクリプトが作る部分にTailwindのクラスが効かなかったため。314章） */
import { colorsOf, setColors, type ListKind } from "./my-cosme-store";

const CSS = `
.cc { display: grid; gap: 0.5rem; margin-top: 0.6rem; }
.cc-h { font-size: 12px; color: rgb(29 21 23 / 0.65); display: flex; flex-wrap: wrap; gap: 0.3rem 0.8rem; align-items: baseline; }
.cc-h button { font-size: 11px; text-decoration: underline; color: rgb(29 21 23 / 0.55); cursor: pointer; }
.cc-list { display: flex; flex-wrap: wrap; gap: 0.35rem; max-height: 14rem; overflow-y: auto; padding: 0.1rem; }
.cc-chip { display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.25rem 0.7rem 0.25rem 0.3rem; border: 1px solid rgb(29 21 23 / 0.15); border-radius: 999px; font-size: 12px; background: #fff; cursor: pointer; line-height: 1.3; text-align: left; }
.cc-chip:hover { border-color: rgb(29 21 23 / 0.5); }
.cc-chip[aria-pressed="true"] { border-color: #1d1517; box-shadow: 0 0 0 1px #1d1517 inset; }
.cc-chip[aria-pressed="true"]::after { content: "✓"; font-size: 11px; margin-left: 0.1rem; }
.cc-dot { width: 1.1rem; height: 1.1rem; border-radius: 999px; border: 1px solid rgb(29 21 23 / 0.15); flex: none; }
.cc-dot.is-none { background: repeating-linear-gradient(45deg, #f3eeec 0 3px, #fff 3px 6px); }
.cc-sum { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.25rem; font-size: 12px; color: rgb(29 21 23 / 0.7); }
.cc-sum .cc-dot { width: 0.85rem; height: 0.85rem; }
`;
function injectCss() {
  if (document.getElementById("cc-css")) return;
  const st = document.createElement("style");
  st.id = "cc-css";
  st.textContent = CSS;
  document.head.appendChild(st);
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const dot = (hex: string) => (hex ? `<span class="cc-dot" style="background:${hex}"></span>` : `<span class="cc-dot is-none" title="色の値はまだありません"></span>`);

/** 選んだ色の短い表示（丸と名前）。何も選んでいなければ空 */
export function colorSummary(labels: string[], colors: [string, string][]): string {
  if (!labels.length) return "";
  const hex = new Map(colors);
  return `<span class="cc-sum">${labels.map((l) => `${dot(hex.get(l) || "")}${esc(l)}`).join("　")}</span>`;
}

/** el の中に、色を選ぶチップの一覧を出す。onChange は保存のあとに呼ぶ */
export function mountColorChooser(el: HTMLElement, slug: string, kind: ListKind, colors: [string, string][], onChange?: (labels: string[]) => void) {
  injectCss();
  const what = kind === "wish" ? "気になる色" : "持っている色";
  const draw = () => {
    const sel = new Set(colorsOf(slug, kind));
    el.innerHTML = `<div class="cc">
      <p class="cc-h"><span>${what}を選ぶ（いくつでも。色から探すの地図に、選んだ色だけが出ます）</span>${sel.size ? `<button type="button" data-cc-clear>選ぶのをやめる</button>` : ""}</p>
      <div class="cc-list">${colors.map(([label, hex]) => `<button type="button" class="cc-chip" data-cc="${esc(label)}" aria-pressed="${sel.has(label)}">${dot(hex)}${esc(label)}</button>`).join("")}</div>
    </div>`;
  };
  el.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const chip = t.closest<HTMLElement>("[data-cc]");
    let next: string[] | null = null;
    if (chip) {
      const sel = new Set(colorsOf(slug, kind));
      const l = chip.dataset.cc!;
      if (sel.has(l)) sel.delete(l); else sel.add(l);
      next = colors.map(([x]) => x).filter((x) => sel.has(x));  // 公式の並び順で持つ
    } else if (t.closest("[data-cc-clear]")) next = [];
    if (next === null) return;
    e.stopPropagation();
    setColors(slug, kind, next);
    draw();
    onChange?.(next);
  });
  draw();
}
