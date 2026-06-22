import { test, expect } from '@playwright/test';

const BOARD_KEY = 'kaambaan.boardId';
const API = 'http://localhost:8787';
const TENANT = { 'X-Tenant-Id': 'tnt_dev', 'Content-Type': 'application/json' };
const DEFAULT_STAGES = [
  { key: 'backlog', name: 'Backlog', order: 0 },
  { key: 'ready', name: 'Ready', order: 1 },
  { key: 'in-progress', name: 'In Progress', order: 2, wipLimit: 3 },
  { key: 'review', name: 'Review', order: 3, gate: 'approval' },
  { key: 'done', name: 'Done', order: 4 },
];

test.beforeEach(async ({ page, request }) => {
  const res = await request.post(`${API}/v1/boards`, {
    headers: TENANT,
    data: { name: 'Nav E2E board', stages: DEFAULT_STAGES },
  });
  const { boardId } = (await res.json()) as { boardId: string };
  await page.addInitScript(
    ([key, id]) => window.localStorage.setItem(key as string, id as string),
    [BOARD_KEY, boardId],
  );
});

test('telemetry screen shows spend', async ({ page }) => {
  await page.goto('/');
  // wait for the flight-deck shell to render (board columns visible)
  await expect(page.getByText('Backlog', { exact: true })).toBeVisible();
  // navigate to telemetry via the rail button
  await page.getByRole('button', { name: /Telemetry/i }).click();
  // the spend metric heading must be visible
  await expect(page.getByText(/Spend/i)).toBeVisible();
});

test('telemetry screen shows "By agent" panel', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Backlog', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Telemetry/i }).click();
  await expect(page.getByText(/By agent/i)).toBeVisible();
});

test('telemetry screen shows "By model" panel', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Backlog', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Telemetry/i }).click();
  await expect(page.getByText(/By model/i)).toBeVisible();
});
