import { defineConfig, devices } from '@playwright/test';

// E2E boots the real app: the API Worker (wrangler dev :8787) and the SvelteKit dev server
// (:5173, which proxies /v1 + the WebSocket to the Worker). See docs/09-testing-strategy.md.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  // Set PW_CHANNEL=chrome to drive a locally-installed Chrome instead of the downloaded browser.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: process.env.PW_CHANNEL || undefined } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @kaambaan/api dev',
      url: 'http://localhost:8787/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @kaambaan/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
