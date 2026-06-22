import { test, expect } from '@playwright/test';

// The theme toggle is web-only: it flips a `data-theme` attribute on <html>, persists the choice to
// localStorage, and on a first visit (no stored choice) follows the OS `prefers-color-scheme`. A tiny
// inline script in app.html applies the stored theme before first paint, so a reload doesn't flash.
const BOARD_KEY = 'kaambaan.boardId';
const THEME_KEY = 'kaambaan.theme';
const API = 'http://localhost:8787';
const TENANT = { 'X-Tenant-Id': 'tnt_dev', 'Content-Type': 'application/json' };
const DEFAULT_STAGES = [
  { key: 'backlog', name: 'Backlog', order: 0 },
  { key: 'ready', name: 'Ready', order: 1 },
  { key: 'in-progress', name: 'In Progress', order: 2, wipLimit: 3 },
  { key: 'review', name: 'Review', order: 3, gate: 'approval' },
  { key: 'done', name: 'Done', order: 4 },
];

async function seedBoard(request: import('@playwright/test').APIRequestContext): Promise<string> {
  const res = await request.post(`${API}/v1/boards`, { headers: TENANT, data: { name: 'Theme E2E board', stages: DEFAULT_STAGES } });
  const { boardId } = (await res.json()) as { boardId: string };
  return boardId;
}

// Only the boardId is seeded (and re-seeding it on reload is harmless). The baseline theme comes from
// the emulated OS preference, NOT a seeded localStorage value — otherwise addInitScript would re-write
// it on every reload and mask the persistence we're trying to assert.
test.describe('theme toggle', () => {
  test.use({ colorScheme: 'dark' });

  test('flips data-theme on <html>, persists the choice, and survives reload without flashing', async ({ page, request }) => {
    const boardId = await seedBoard(request);
    await page.addInitScript(([bk, id]) => window.localStorage.setItem(bk as string, id as string), [BOARD_KEY, boardId]);

    await page.goto('/');
    await expect(page.getByText('Backlog', { exact: true })).toBeVisible();

    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'dark'); // OS-dark, no stored choice

    // Toggle → light, and the choice is written to localStorage.
    await page.getByRole('button', { name: /toggle theme/i }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate((k) => localStorage.getItem(k), THEME_KEY)).toBe('light');

    // Survives a reload and is applied before first paint (still light, despite OS preferring dark).
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await expect(page.getByText('Backlog', { exact: true })).toBeVisible();
  });
});

test.describe('first visit with no stored choice', () => {
  test.use({ colorScheme: 'light' });

  test('follows prefers-color-scheme (light)', async ({ page, request }) => {
    const boardId = await seedBoard(request);
    await page.addInitScript(([bk, id]) => window.localStorage.setItem(bk as string, id as string), [BOARD_KEY, boardId]);
    await page.goto('/');
    await expect(page.getByText('Backlog', { exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
});
