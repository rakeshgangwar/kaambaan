import { test, expect } from '@playwright/test';

const BOARD_KEY = 'kaambaan.boardId';

// Each test starts from a fresh board (the app creates one when localStorage is empty).
test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => window.localStorage.removeItem(key), BOARD_KEY);
});

test('renders the pipeline columns and connects live', async ({ page }) => {
  await page.goto('/');
  for (const col of ['Backlog', 'Ready', 'In Progress', 'Review', 'Done']) {
    await expect(page.getByText(col, { exact: true })).toBeVisible();
  }
  await expect(page.getByText('live', { exact: true })).toBeVisible();
});

test('creates a card via the composer', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('New card title').fill('Write the launch post');
  await page.getByRole('button', { name: 'Dispatch' }).click();
  await expect(page.getByText('Write the launch post')).toBeVisible();
});

test('moves a card to another column via drag', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('New card title').fill('Draggable task');
  await page.getByRole('button', { name: 'Dispatch' }).click();

  const card = page.locator('article', { hasText: 'Draggable task' });
  await expect(card).toBeVisible();

  const ready = page.locator('section').filter({ has: page.getByText('Ready', { exact: true }) });
  await card.dragTo(ready);

  await expect(ready.locator('article', { hasText: 'Draggable task' })).toBeVisible();
});

test('streams a new card to a second client in real time', async ({ browser }) => {
  const a = await browser.newPage();
  await a.addInitScript((key) => window.localStorage.removeItem(key), BOARD_KEY);
  await a.goto('/');
  await expect(a.getByText('Backlog', { exact: true })).toBeVisible();

  const boardId = await a.evaluate((key) => window.localStorage.getItem(key), BOARD_KEY);
  expect(boardId).toBeTruthy();

  // Second client opens the SAME board, then subscribes to its live feed.
  const b = await browser.newPage();
  await b.addInitScript(
    ([key, id]) => window.localStorage.setItem(key, id),
    [BOARD_KEY, boardId as string] as const,
  );
  await b.goto('/');
  await expect(b.getByText('Backlog', { exact: true })).toBeVisible();

  await a.getByLabel('New card title').fill('Realtime card');
  await a.getByRole('button', { name: 'Dispatch' }).click();

  await expect(b.getByText('Realtime card')).toBeVisible({ timeout: 10_000 });
});
