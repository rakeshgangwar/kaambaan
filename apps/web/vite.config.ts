import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    port: 5173,
    // Proxy API + live WebSocket to the Worker dev server (`wrangler dev`, default :8787).
    proxy: {
      '/v1': { target: 'http://localhost:8787', changeOrigin: true, ws: true },
      '/health': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
});
