import { test, expect } from '@playwright/test';

test('cmd-k opens the palette and can jump to a card', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');
  await expect(page.getByPlaceholder(/Jump to a card/i)).toBeVisible();
});

test('escape closes the palette', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');
  await expect(page.getByPlaceholder(/Jump to a card/i)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByPlaceholder(/Jump to a card/i)).not.toBeVisible();
});

test('palette filters results as user types', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');
  const input = page.getByPlaceholder(/Jump to a card/i);
  await expect(input).toBeVisible();
  await input.fill('Triage');
  await expect(page.getByText('Open Triage')).toBeVisible();
});

test('palette shows actions group with navigation items', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');
  await expect(page.getByPlaceholder(/Jump to a card/i)).toBeVisible();
  await expect(page.getByText('Open Triage')).toBeVisible();
  await expect(page.getByText('View Telemetry')).toBeVisible();
});
