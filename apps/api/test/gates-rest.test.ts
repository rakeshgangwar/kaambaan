import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

const REVIEW_PIPELINE = [
  { key: 'research', name: 'Research', order: 0, ownerKind: 'capability', owner: 'research' },
  { key: 'review', name: 'Review', order: 1, ownerKind: 'human', gate: 'approval' },
  { key: 'publish', name: 'Publish', order: 2, ownerKind: 'capability', owner: 'publish' },
];

const SUBMIT_PIPELINE = [
  { key: 'build', name: 'Build', order: 0, ownerKind: 'capability', owner: 'build', gate: 'approval' },
  { key: 'ship', name: 'Ship', order: 1, ownerKind: 'capability', owner: 'ship' },
];

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { 'X-Tenant-Id': 'tnt_a', 'Content-Type': 'application/json', ...extra };
}

async function createBoard(stages: unknown): Promise<string> {
  const res = await SELF.fetch('https://api.test/v1/boards', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ name: 'Gated', stages }),
  });
  return ((await res.json()) as { boardId: string }).boardId;
}

async function addCard(boardId: string): Promise<void> {
  await SELF.fetch(`https://api.test/v1/boards/${boardId}/cards`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ title: 'Work', ownerUserId: 'usr_a' }),
  });
}

async function claim(boardId: string, agentId: string, capability: string) {
  const res = await SELF.fetch(`https://api.test/v1/boards/${boardId}/claims`, {
    method: 'POST',
    headers: headers({ 'X-Agent-Id': agentId }),
    body: JSON.stringify({ capabilities: [capability] }),
  });
  return (await res.json()) as { runId: string; leaseEpoch: number };
}

async function gateIdOf(boardId: string): Promise<string> {
  const res = await SELF.fetch(`https://api.test/v1/boards/${boardId}`, { headers: headers() });
  const body = (await res.json()) as { gates: { id: string }[] };
  return body.gates[0]!.id;
}

describe('gate REST surface', () => {
  it('opens a gate on review and approves it via REST', async () => {
    const boardId = await createBoard(REVIEW_PIPELINE);
    await addCard(boardId);
    const c = await claim(boardId, 'agt_r', 'research');
    await SELF.fetch(`https://api.test/v1/boards/${boardId}/runs/${c.runId}/complete`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ leaseEpoch: c.leaseEpoch, handoff: { summary: 'drafted' } }),
    });

    const gateId = await gateIdOf(boardId);
    const res = await SELF.fetch(`https://api.test/v1/boards/${boardId}/gates/${gateId}/resolve`, {
      method: 'POST',
      headers: headers({ 'X-User-Id': 'usr_x' }),
      body: JSON.stringify({ decision: 'approve' }),
    });
    expect(res.status).toBe(200);
    const { card } = (await res.json()) as { card: { currentStageKey: string } };
    expect(card.currentStageKey).toBe('publish');
  });

  it('rejects a self-resolved gate with 403 (separation of duties)', async () => {
    const boardId = await createBoard(REVIEW_PIPELINE);
    await addCard(boardId);
    const c = await claim(boardId, 'agt_r', 'research');
    await SELF.fetch(`https://api.test/v1/boards/${boardId}/runs/${c.runId}/complete`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ leaseEpoch: c.leaseEpoch }),
    });
    const gateId = await gateIdOf(boardId);
    const res = await SELF.fetch(`https://api.test/v1/boards/${boardId}/gates/${gateId}/resolve`, {
      method: 'POST',
      headers: headers({ 'X-User-Id': 'agt_r' }), // the producer trying to approve itself
      body: JSON.stringify({ decision: 'approve' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated gate resolve (identity comes from auth, not a header)', async () => {
    const boardId = await createBoard(REVIEW_PIPELINE);
    await addCard(boardId);
    const c = await claim(boardId, 'agt_r', 'research');
    await SELF.fetch(`https://api.test/v1/boards/${boardId}/runs/${c.runId}/complete`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ leaseEpoch: c.leaseEpoch }),
    });
    const gateId = await gateIdOf(boardId);
    // No auth at all (no session, no dev tenant header) → 401.
    const res = await SELF.fetch(`https://api.test/v1/boards/${boardId}/gates/${gateId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    });
    expect(res.status).toBe(401);
  });

  it('submits a gated agent stage for review via REST', async () => {
    const boardId = await createBoard(SUBMIT_PIPELINE);
    await addCard(boardId);
    const c = await claim(boardId, 'agt_build', 'build');
    const res = await SELF.fetch(`https://api.test/v1/boards/${boardId}/runs/${c.runId}/submit`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ leaseEpoch: c.leaseEpoch }),
    });
    expect(res.status).toBe(200);
    const { card } = (await res.json()) as { card: { state: string } };
    expect(card.state).toBe('input-required');
  });
});
