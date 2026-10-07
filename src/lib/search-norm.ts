/** 表記ゆれを吸収する正規化：全角半角・大小文字・ひらがな/カタカナをそろえ、記号と空白を除く。
 * 「クレド」で「クレ・ド・ポー ボーテ」、「ロムアンド」「romand」で「rom&nd」が引けるようにする。
 * 検索結果のページと、検索欄の候補（search-suggest.ts）の両方で使う。 */
export const norm = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // é → e（Clé de Peau など）。濁点は下で戻す
    .normalize("NFC")
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .replace(/ヴァ/g, "バ").replace(/ヴィ/g, "ビ").replace(/ヴェ/g, "ベ").replace(/ヴォ/g, "ボ").replace(/ヴ/g, "ブ")
    .replace(/[\s・･·.,\-‐－_&＆'’"!！?？()（）［］\[\]「」『』/／~〜:：+＋#＃*＊]/g, "");

/** 空白区切りの検索語を、正規化した語の配列にする（すべてを含むものだけを出すため） */
export const splitTerms = (q: string) => q.split(/[\s　]+/).map(norm).filter(Boolean);
