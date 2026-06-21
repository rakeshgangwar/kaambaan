import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { KaambaanAgent, runOnce, type Fetcher } from '@kaambaan/agent-sdk';

// The conformance kit (docs/09 §5): drive a real agent through the loop using ONLY the public
// REST contract (via @kaambaan/agent-sdk) and assert the full lifecycle.

const STAGES = [
  { key: 'research', name: 'Research', order: 0, ownerKind: 'capability', owner: 'research' },
  { key: 'build', name: 'Build', order: 1, ownerKind: 'capability', owner: 'build' },
];

const fetcher: Fetcher = (url, init) => SELF.fetch(url, init);

async function createBoard(): Promise<string> {
  const res = await SELF.fetch('https://api.test/v1/boards', {
    method: 'POST',
    headers: { 'X-Tenant-Id': 'tnt_a', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Conformance', stages: STAGES }),
  });
  return ((await res.json()) as { boardId: string }).boardId;
}

function agent(boardId: string, agentId: string, capability: string): KaambaanAgent {
  return new KaambaanAgent({
    baseUrl: 'https://api.test',
    tenantId: 'tnt_a',
    boardId,
    agentId,
    capabilities: [capability],
    fetch: fetcher,
  });
}

describe('agent conformance kit', () => {
  it('a reference agent drives a card through a two-stage pipeline', async () => {
    const boardId = await createBoard();
    await SELF.fetch(`https://api.test/v1/boards/${boardId}/cards`, {
      method: 'POST',
      headers: { 'X-Tenant-Id': 'tnt_a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Do the research', ownerUserId: 'usr_a' }),
    });

    const researcher = agent(boardId, 'agt_r', 'research');
    const builder = agent(boardId, 'agt_b', 'build');

    // Stage 1: the research agent claims and completes, passing a handoff.
    const workedResearch = await runOnce(researcher, async (w) => ({ summary: `researched: ${w.card.title}` }));
    expect(workedResearch).toBe(true);

    // Stage 2: the build agent receives the handoff and finishes the card.
    const workedBuild = await runOnce(builder, async (w) => {
      expect(w.handoff).toMatchObject({ summary: expect.stringContaining('researched') });
      return { built: true };
    });
    expect(workedBuild).toBe(true);

    // Nothing left to claim.
    expect(await runOnce(researcher, async () => undefined)).toBe(false);

    // The card reached the terminal state via the public contract alone.
    const state = (await (
      await SELF.fetch(`https://api.test/v1/boards/${boardId}`, { headers: { 'X-Tenant-Id': 'tnt_a' } })
    ).json()) as { cards: { state: string }[] };
    expect(state.cards[0]!.state).toBe('completed');
  });

  it('reports idle when there is no matching work', async () => {
    const boardId = await createBoard();
    const idle = agent(boardId, 'agt_z', 'design');
    expect(await runOnce(idle, async () => undefined)).toBe(false);
  });

  it('fails the run (freeing the card) when the work handler throws', async () => {
    const boardId = await createBoard();
    await SELF.fetch(`https://api.test/v1/boards/${boardId}/cards`, {
      method: 'POST',
      headers: { 'X-Tenant-Id': 'tnt_a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Will crash', ownerUserId: 'usr_a' }),
    });
    const researcher = agent(boardId, 'agt_r', 'research');

    await expect(
      runOnce(researcher, async () => {
        throw new Error('handler boom');
      }),
    ).rejects.toThrow('handler boom');

    // The run was failed rather than left hanging, so the card is immediately back to submitted
    // (one failure, below the breaker) — not stuck 'working' until the 15-minute reclaim.
    const state = (await (
      await SELF.fetch(`https://api.test/v1/boards/${boardId}`, { headers: { 'X-Tenant-Id': 'tnt_a' } })
    ).json()) as { cards: { state: string }[] };
    expect(state.cards[0]!.state).toBe('submitted');
  });
});
