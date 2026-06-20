import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

const STAGES = [
  { key: 'research', name: 'Research', order: 0, ownerKind: 'capability', owner: 'research' },
  { key: 'build', name: 'Build', order: 1, ownerKind: 'capability', owner: 'build' },
];

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { 'X-Tenant-Id': 'tnt_a', 'Content-Type': 'application/json', ...extra };
}

async function createBoard(): Promise<string> {
  const res = await SELF.fetch('https://api.test/v1/boards', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ name: 'Agents', stages: STAGES }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { boardId: string }).boardId;
}

async function addCard(boardId: string, title: string): Promise<void> {
  const res = await SELF.fetch(`https://api.test/v1/boards/${boardId}/cards`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ title, ownerUserId: 'usr_a' }),
  });
  expect(res.status).toBe(201);
}

function claim(boardId: string, agentId: string, capabilities: string[]) {
  return SELF.fetch(`https://api.test/v1/boards/${boardId}/claims`, {
    method: 'POST',
    headers: headers({ 'X-Agent-Id': agentId }),
    body: JSON.stringify({ capabilities }),
  });
}

function runAction(boardId: string, runId: string, action: string, body: unknown) {
  return SELF.fetch(`https://api.test/v1/boards/${boardId}/runs/${runId}/${action}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
}

describe('agent REST contract', () => {
  it('claims a card for a matching agent', async () => {
    const boardId = await createBoard();
    await addCard(boardId, 'Summarize');
    const res = await claim(boardId, 'agt_r', ['research']);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { claimed: boolean; runId?: string; leaseEpoch?: number };
    expect(body.claimed).toBe(true);
    expect(body.runId).toMatch(/^run_/);
    expect(body.leaseEpoch).toBe(1);
  });

  it('returns claimed:false when no work matches', async () => {
    const boardId = await createBoard();
    const res = await claim(boardId, 'agt_x', ['design']);
    expect(res.status).toBe(200);
    expect((await res.json()) as { claimed: boolean }).toMatchObject({ claimed: false });
  });

  it('requires an agent identity to claim', async () => {
    const boardId = await createBoard();
    const res = await SELF.fetch(`https://api.test/v1/boards/${boardId}/claims`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ capabilities: ['research'] }),
    });
    expect(res.status).toBe(400);
  });

  it('drives a full claim → heartbeat → activity → complete loop', async () => {
    const boardId = await createBoard();
    await addCard(boardId, 'Ship it');
    const claimed = (await (await claim(boardId, 'agt_r', ['research'])).json()) as {
      runId: string;
      leaseEpoch: number;
    };

    expect((await runAction(boardId, claimed.runId, 'heartbeat', { leaseEpoch: claimed.leaseEpoch })).status).toBe(200);
    expect(
      (
        await runAction(boardId, claimed.runId, 'activities', {
          leaseEpoch: claimed.leaseEpoch,
          type: 'thought',
          body: 'working on it',
          ephemeral: true,
        })
      ).status,
    ).toBe(200);

    const done = await runAction(boardId, claimed.runId, 'complete', {
      leaseEpoch: claimed.leaseEpoch,
      handoff: { summary: 'researched' },
    });
    expect(done.status).toBe(200);
    const { card } = (await done.json()) as { card: { currentStageKey: string } };
    expect(card.currentStageKey).toBe('build');
  });

  it('rejects a stale lease with 409', async () => {
    const boardId = await createBoard();
    await addCard(boardId, 'A');
    const claimed = (await (await claim(boardId, 'agt_r', ['research'])).json()) as {
      runId: string;
      leaseEpoch: number;
    };
    const res = await runAction(boardId, claimed.runId, 'heartbeat', { leaseEpoch: claimed.leaseEpoch + 99 });
    expect(res.status).toBe(409);
  });
});
