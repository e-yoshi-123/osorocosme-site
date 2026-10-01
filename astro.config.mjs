// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://osorocosme.com',
  devToolbar: { enabled: false },
  vite: {
    plugins: [tailwindcss()]
  }
});