import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { connectMcp, depsFor, initBoard, toolJson, RESEARCH_PIPELINE } from './helpers/mcp';
import type { BoardStub, CardView } from '../src/board/board-do';

/**
 * Contract parity (docs/05, docs/10 P4): the MCP tools and the REST endpoints are the SAME contract
 * projected onto two wires. Driving an identical claim→activity→complete sequence through each must
 * leave the board in the same state.
 */
const AUTH = { tenantId: 'tnt_par', agentId: 'agt_x', capabilities: ['research'] };
const REST = { 'X-Tenant-Id': AUTH.tenantId, 'Content-Type': 'application/json' };
const base = 'https://api.test';

const pick = (c: CardView) => ({ currentStageKey: c.currentStageKey, state: c.state });
const post = (path: string, body: unknown, extra: Record<string, string> = {}) =>
  SELF.fetch(`${base}${path}`, { method: 'POST', headers: { ...REST, ...extra }, body: JSON.stringify(body) });

async function seed(boardId: string): Promise<BoardStub> {
  const stub = await initBoard(AUTH, boardId, RESEARCH_PIPELINE);
  await stub.createCard({ title: 'Parity card', ownerUserId: 'usr_a' });
  return stub;
}

describe('MCP ≡ REST — contract parity', () => {
  it('a claim→activity→complete pipeline lands the card identically on both surfaces', async () => {
    // --- MCP surface ---
    const mcpStub = await seed('brd_par_mcp');
    const client = await connectMcp(depsFor(AUTH));
    const mcpClaim = toolJson(
      await client.callTool({ name: 'kaambaan_claim_card', arguments: { boardId: 'brd_par_mcp' } }),
    ) as { claimed: boolean; runId: string; leaseEpoch: number; handoff: unknown };
    await client.callTool({
      name: 'kaambaan_post_activity',
      arguments: { boardId: 'brd_par_mcp', runId: mcpClaim.runId, leaseEpoch: mcpClaim.leaseEpoch, type: 'thought', body: 'working', ephemeral: true },
    });
    await client.callTool({
      name: 'kaambaan_complete',
      arguments: { boardId: 'brd_par_mcp', runId: mcpClaim.runId, leaseEpoch: mcpClaim.leaseEpoch, handoff: { summary: 'done' } },
    });
    const mcpCard = (await mcpStub.getState()).cards[0]!;

    // --- REST surface (same sequence) ---
    const restStub = await seed('brd_par_rest');
    const restClaim = (await (
      await post('/v1/boards/brd_par_rest/claims', { capabilities: AUTH.capabilities }, { 'X-Agent-Id': AUTH.agentId })
    ).json()) as { claimed: boolean; runId: string; leaseEpoch: number; handoff: unknown };
    await post(`/v1/boards/brd_par_rest/runs/${restClaim.runId}/activities`, {
      leaseEpoch: restClaim.leaseEpoch,
      type: 'thought',
      body: 'working',
      ephemeral: true,
    });
    await post(`/v1/boards/brd_par_rest/runs/${restClaim.runId}/complete`, {
      leaseEpoch: restClaim.leaseEpoch,
      handoff: { summary: 'done' },
    });
    const restCard = (await restStub.getState()).cards[0]!;

    // Claims agree in shape …
    expect(mcpClaim.claimed).toBe(true);
    expect(restClaim.claimed).toBe(true);
    expect(mcpClaim.leaseEpoch).toBe(restClaim.leaseEpoch);
    expect(mcpClaim.runId).toMatch(/^run_/);
    expect(restClaim.runId).toMatch(/^run_/);

    // … and the card lands in the same place: at the review gate, awaiting human input.
    expect(pick(mcpCard)).toEqual(pick(restCard));
    expect(pick(mcpCard)).toEqual({ currentStageKey: 'review', state: 'input-required' });
  });

  it('a business failure is reported on both surfaces (stale lease)', async () => {
    const mcpStub = await seed('brd_par_mcp2');
    const client = await connectMcp(depsFor(AUTH));
    const claim = toolJson(
      await client.callTool({ name: 'kaambaan_claim_card', arguments: { boardId: 'brd_par_mcp2' } }),
    ) as { runId: string; leaseEpoch: number };
    void mcpStub;
    const mcpRes = await client.callTool({
      name: 'kaambaan_complete',
      arguments: { boardId: 'brd_par_mcp2', runId: claim.runId, leaseEpoch: claim.leaseEpoch + 9 },
    });

    await seed('brd_par_rest2');
    const restClaim = (await (
      await post('/v1/boards/brd_par_rest2/claims', { capabilities: AUTH.capabilities }, { 'X-Agent-Id': AUTH.agentId })
    ).json()) as { runId: string; leaseEpoch: number };
    const restRes = await post(`/v1/boards/brd_par_rest2/runs/${restClaim.runId}/complete`, {
      leaseEpoch: restClaim.leaseEpoch + 9,
    });

    // MCP signals the failure model-visibly (isError); REST signals it with a 409 — same business code.
    expect(mcpRes.isError).toBe(true);
    expect((mcpRes.content as Array<{ text: string }>)[0]!.text).toContain('STALE_LEASE');
    expect(restRes.status).toBe(409);
    expect(JSON.stringify(await restRes.json())).toContain('STALE_LEASE');
  });
});
