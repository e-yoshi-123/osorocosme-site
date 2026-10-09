// 運営者情報・問い合わせ先（固定ページとフッターで共通に使う）。
// 公開前に、下の2つを実際の値に書き換える。
export const OPERATOR_NAME = "おそろ"; // ハンドルネーム
export const CONTACT_FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSe1I35BL4LcBqaOPCLdTmJwKnGAiOEGYlkUixcuVcsMKiFnaw/viewform"; // GoogleフォームのURL
export const POLICY_UPDATED = "2026年10月9日";
// Googleアナリティクス4の測定ID（公開されるID）。本番ビルドでのみタグを出力する（Layout.astro）。
export const GA_MEASUREMENT_ID = "G-2FPCHCMB22";
// マイコスメのGoogleドライブ同期（5-4の案B）に使う、Google CloudのOAuthクライアントID（公開されるID。秘密ではない）。
// 空のあいだは、マイコスメのページにGoogleドライブの欄を出さない（ブラウザ内の保存とファイルの書き出し・読み込みだけ）
export const GOOGLE_CLIENT_ID = "132520648308-3th6me11gtf7rrq1ta2ir6rdpok6jk0p.apps.googleusercontent.com";
