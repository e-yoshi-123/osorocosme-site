// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://e-yoshi-123.github.io',
  base: '/osorocosme-site',
  vite: {
    plugins: [tailwindcss()]
  }
});