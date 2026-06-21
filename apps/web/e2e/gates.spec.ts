import { test, expect } from '@playwright/test';

// The UI talks to the API as tenant 'tnt_dev' (see src/lib/api.ts), so the E2E drives the agent
// under the same tenant and points the board at the resulting gate.
const API = 'http://localhost:8787';
const TENANT = { 'X-Tenant-Id': 'tnt_dev', 'Content-Type': 'application/json' };

const REVIEW_PIPELINE = [
  { key: 'research', name: 'Research', order: 0, ownerKind: 'capability', owner: 'research' },
  { key: 'review', name: 'Review', order: 1, ownerKind: 'human', gate: 'approval' },
  { key: 'publish', name: 'Publish', order: 2, ownerKind: 'capability', owner: 'publish' },
];

test('a human approves an agent-opened gate from the board', async ({ page, request }) => {
  // 1. Open an approval gate by driving a research agent through the public contract.
  const board = await (
    await request.post(`${API}/v1/boards`, { headers: TENANT, data: { name: 'Gate demo', stages: REVIEW_PIPELINE } })
  ).json();
  const boardId = board.boardId as string;

  await request.post(`${API}/v1/boards/${boardId}/cards`, {
    headers: TENANT,
    data: { title: 'Launch post', ownerUserId: 'usr_a' },
  });
  const claim = await (
    await request.post(`${API}/v1/boards/${boardId}/claims`, {
      headers: { ...TENANT, 'X-Agent-Id': 'agt_r' },
      data: { capabilities: ['research'] },
    })
  ).json();
  await request.post(`${API}/v1/boards/${boardId}/runs/${claim.runId}/complete`, {
    headers: TENANT,
    data: { leaseEpoch: claim.leaseEpoch, handoff: { summary: 'drafted' } },
  });

  // 2. Load that board in the UI — the card sits at the review gate with resolve actions.
  await page.addInitScript((id) => window.localStorage.setItem('kaambaan.boardId', id), boardId);
  await page.goto('/');

  const review = page.locator('section').filter({ has: page.getByText('Review', { exact: true }) });
  await expect(review.locator('article', { hasText: 'Launch post' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();

  // 3. Approve — the card advances past the gate into Publish.
  await page.getByRole('button', { name: 'Approve' }).click();

  const publish = page.locator('section').filter({ has: page.getByText('Publish', { exact: true }) });
  await expect(publish.locator('article', { hasText: 'Launch post' })).toBeVisible();
});
