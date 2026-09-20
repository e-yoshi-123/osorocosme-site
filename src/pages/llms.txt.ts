import type { APIRoute } from "astro";
import { getVisibleVideos, getBrandsWithVideos, getInfluencerRanking, getCosmeticRankings, getPopularBrands, withBase } from "../lib/data";

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const u = (p: string) => new URL(withBase(p), site).href;
  const body = `# OsoroCosme

> YouTubeのコスメ紹介動画から「誰が・いつ・どのコスメを使ったか」を抽出して集めたデータベース。動画${getVisibleVideos().length}本、インフルエンサー${getInfluencerRanking().length}人、ブランド${getBrandsWithVideos().length}件、コスメ${getCosmeticRankings().length}品を収録。

## 主要ページ
- [カテゴリ別ランキング](${u("/ranking")}): 化粧下地・ファンデーション・リップなどカテゴリごとの人気コスメ。紹介動画の合計再生数・紹介動画数・紹介したインフルエンサー数から算出したスコア順
- [ブランド一覧](${u("/brand-list")}): 動画で紹介されたブランド（人気上位: ${getPopularBrands(5).map((b) => b.name).join("、")}）
- [インフルエンサー一覧](${u("/influencer-list")}): 各インフルエンサーの使用コスメ遍歴を、カテゴリ別・投稿日順で確認できる
- [動画一覧](${u("/video-list")}): 収録している紹介動画

## ページ構成
- コスメ詳細 \`/cosmetics/{brand_id}-{name_id}\`: そのコスメを紹介した動画・インフルエンサーと日付、カテゴリ内順位
- ブランド詳細 \`/brand/{brand_id}\` / インフルエンサー詳細 \`/influencer/{channel_id}\` / 動画詳細 \`/video/{video_key}\`

## 注意
- 順位・スコアは、このサイトが収録した動画の範囲での集計であり、商品の品質評価ではありません
- 動画・サムネイルの著作権は各投稿者に帰属します
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
