import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    // The board is a client-only SPA (see +layout.ts). Build to static assets with an index.html
    // fallback so the API Worker can serve them same-origin (cookies + relative fetches just work).
    adapter: adapter({ fallback: 'index.html' }),
  },
};
