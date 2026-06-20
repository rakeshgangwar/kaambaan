import { defineConfig } from 'vitest/config';

// P0 unit tests run in plain Node. Component tests against the Board DO arrive in P1 via
// @cloudflare/vitest-pool-workers (see docs/09-testing-strategy.md §3).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
