import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

// vitest-pool-workers (vitest 4 line) wires the Workers runtime via a Vite plugin that reads our
// wrangler config for bindings (DB, BOARD_DO) and the Worker entry (docs/09-testing-strategy.md §3).
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  test: {
    include: ['test/**/*.test.ts'],
  },
});
