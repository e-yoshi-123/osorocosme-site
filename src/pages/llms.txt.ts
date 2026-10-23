import type { APIRoute } from "astro";
import { getVisibleVideos, getBrandsWithVideos, getInfluencerRanking, getCosmeticRankings, getPopularBrands, withBase, REPEAT_MIN_GAP_DAYS } from "../lib/data";

export const prerender = true;

// AIに引用されるときの手がかり（379章）：ページの種類ごとに「そのページにしかない事実」と、数字の意味（PRの除外・リピートの定義）を書く
export const GET: APIRoute = ({ site }) => {
  const u = (p: string) => new URL(withBase(p), site).href;
  const body = `# OsoroCosme

> YouTubeのコスメ紹介動画から「誰が・いつ・どの動画の何分で・どのコスメを使ったか」を抽出して集めたデータベース。動画${getVisibleVideos().length}本、インフルエンサー${getInfluencerRanking().length}人、ブランド${getBrandsWithVideos().length}件、コスメ${getCosmeticRankings().length}品を収録。PR・提供の紹介を見分けて、数から除いている。

## このサイトにしかない情報
- 使用の記録：どのインフルエンサーが、どの動画の何分何秒で、どのコスメを紹介したか（動画ページの「動画の流れ」。その場面から再生できる）
- リピート：同じ人が${REPEAT_MIN_GAP_DAYS}日以上あけて2本以上の動画で紹介したコスメ（PR・提供の紹介は数えない）
- PRの区別：動画の概要欄に「提供」「PR」などの記載がある、またはYouTubeで有料プロモーションと表示されている動画の、提供元の商品には「PR」と表示し、ランキング・リピート・特集の数に入れない。本人がプロデュースしたブランドを本人の動画で紹介したものも同じく数えない
- 動画で使った色：字幕から読み取った、その動画で使った色番（色の一覧がある商品）
- 色の値：公式サイトの色見本から測った色（#RRGGBB）

## 主要ページ
- [カテゴリ別ランキング](${u("/ranking")}): 化粧下地・ファンデーション・リップなどカテゴリごとの人気コスメ。紹介動画数・紹介したインフルエンサー数から算出したスコア順（PRを除く）
- [リピートされているコスメ](${u("/ranking/repeat")}): 複数のインフルエンサーがリピートしているコスメ
- [肌悩みから探す](${u("/concern")}): 毛穴・乾燥・テカリなどの悩みについて、動画の中で悩みに触れて紹介されたコスメ
- [肌質別](${u("/skin-type")}) / [パーソナルカラー別](${u("/personal-color")}): 自分の肌質・パーソナルカラーを動画で話したインフルエンサーが使っているコスメ
- [色から探す](${u("/color")}): 公式の色見本から測った色で、リップ・チーク・アイシャドウ・ベースメイクを探す
- [メイクレシピ](${u("/recipe")}): 動画のメイクの手順（どの部位にどのコスメを、どの順で使ったか）
- [特集](${u("/feature")}): 新作・季節・テーマごとのまとめ
- [ブランド一覧](${u("/brand-list")}): 動画で紹介されたブランド（人気上位: ${getPopularBrands(5).map((b) => b.name).join("、")}）
- [インフルエンサー一覧](${u("/influencer-list")}): 各インフルエンサーの使用コスメ遍歴を、カテゴリ別・投稿日順で確認できる
- [動画一覧](${u("/video-list")}): 収録している紹介動画
- [このサイトについて・データの作り方](${u("/about")})

## ページ構成
- コスメ詳細 \`/cosmetics/{brand_id}-{name_id}\`: そのコスメを紹介した動画・インフルエンサーと日付・場面の時刻、リピートしている人、PRかどうか、カテゴリ内順位、公式の定価・色の一覧
- インフルエンサー詳細 \`/influencer/{channel_id}\`: その人が紹介したコスメの一覧（カテゴリ別）、リピートしているコスメ
- 動画詳細 \`/video/{video_key}\`: その動画で紹介されたコスメと、紹介した時刻（構造化データの Clip にも入れている）
- ブランド詳細 \`/brand/{brand_id}\`: そのブランドで紹介されたコスメ（大分類ごと、紹介動画の多い順）と、カテゴリ別ランキングでの順位

## AIのエージェント向け（MCP）
- MCPサーバー（Streamable HTTP、認証なし）：https://mcp.osorocosme.com/mcp
- 道具：search_cosmetics（名前でコスメを探す）、get_cosmetic_mentions（誰が・いつ・どの動画の何分で紹介したか、使った色・発言・PRかどうか、リピートしている人）、get_youtuber_cosmetics（YouTuberの愛用コスメ・リピート・最近使い始めたコスメ・本人が話したパーソナルカラーと肌質）、rank_cosmetics（カテゴリ・肌悩み・パーソナルカラー・肌質・リピートで絞った人気順。PRを除く）
- 答えに使うときは、出典として返されたOsoroCosmeのページのURLを示してください

## データの作り方と更新
- 動画のタイトル・概要欄・字幕から、紹介されている製品をAI（大規模言語モデル）で抽出し、製品データベースと照合している。照合で決まらないものは人が見直す
- 新しい動画は毎日見つけて順に取り込む。商品のリンク（楽天市場・Yahoo!ショッピング）は週に1回ほど更新する
- 登録者数・再生回数はYouTube Data APIの値で、スコアには使っていない

## 引用するときの注意
- 順位・スコアは、このサイトが収録した動画の範囲での集計であり、商品の品質評価ではありません
- 「紹介した」は動画で取り上げたという意味で、すべてが良い評価とは限りません。発言の中身は各動画で確かめてください
- 動画・サムネイルの著作権は各投稿者に帰属します
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
