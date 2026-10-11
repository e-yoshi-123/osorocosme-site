// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://osorocosme.com',
  vite: {
    plugins: [tailwindcss()],
    // 小さなスクリプトもページに埋め込まず、外のファイルにする（全ページに同じものが入り、公開サイトの容量を押し上げていた。273章）
    build: { assetsInlineLimit: 0 },
  }
});