/** 帯・パレットの1色ずつの表示名「01 クリアカバー（左上 グリーン）」から、商品の色の名前「01 クリアカバー」を取る（363章）。
 * 末尾のかっこは「（レッドオレンジ（青クマ））」のように二重のこともあるので、対応を数えて外す。export_colors.py が付けたかっこ1つだけを外す */
export function colorBaseLabel(label: string): string {
  if (!label.endsWith("）")) return label;
  let depth = 0;
  for (let i = label.length - 1; i >= 0; i--) {
    const ch = label[i];
    if (ch === "）") depth++;
    else if (ch === "（" && --depth === 0) return i > 0 ? label.slice(0, i) : label;
  }
  return label;
}
