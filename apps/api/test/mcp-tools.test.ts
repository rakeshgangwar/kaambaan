import { describe, it, expect } from 'vitest';
import { connectMcp, depsFor, initBoard, toolJson, RESEARCH_PIPELINE } from './helpers/mcp';

const AUTH = { tenantId: 'tnt_a', agentId: 'agt_r', capabilities: ['research'] };

describe('MCP tools — registration', () => {
  it('exposes the agent-contract verbs with honest annotations (docs/05 §2)', async () => {
    const client = await connectMcp(depsFor(AUTH));
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));

    expect([...byName.keys()].sort()).toEqual([
      'kaambaan_block',
      'kaambaan_claim_card',
      'kaambaan_complete',
      'kaambaan_fail',
      'kaambaan_get_card',
      'kaambaan_heartbeat',
      'kaambaan_post_activity',
      'kaambaan_release',
      'kaambaan_submit_for_review',
    ]);

    // The annotation table in docs/05 §2 — honest hints so harnesses prompt humans correctly.
    expect(byName.get('kaambaan_get_card')!.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true });
    expect(byName.get('kaambaan_claim_card')!.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    });
    expect(byName.get('kaambaan_heartbeat')!.annotations).toMatchObject({ idempotentHint: true });
    expect(byName.get('kaambaan_block')!.annotations).toMatchObject({ destructiveHint: true });
    expect(byName.get('kaambaan_fail')!.annotations).toMatchObject({ destructiveHint: true });
    expect(byName.get('kaambaan_release')!.annotations).toMatchObject({ destructiveHint: true });
  });
});

describe('MCP tools — claim & lifecycle', () => {
  it('claims a ready card, returning the run + handoff context the agent needs', async () => {
    await initBoard(AUTH, 'brd_claim', RESEARCH_PIPELINE);
    const setup = depsFor(AUTH).boardStub('brd_claim');
    const created = await setup.createCard({ title: 'Write the post', ownerUserId: 'usr_a' });
    if (!created.ok) throw new Error('seed failed');

    const client = await connectMcp(depsFor(AUTH));
    const res = await client.callTool({ name: 'kaambaan_claim_card', arguments: { boardId: 'brd_claim' } });
    const claim = toolJson(res) as { claimed: boolean; runId?: string; leaseEpoch?: number; card?: { id: string } };

    expect(res.isError).toBeFalsy();
    expect(claim.claimed).toBe(true);
    expect(claim.runId).toMatch(/^run_/);
    expect(claim.card?.id).toBe(created.value.id);
  });

  it('reports no work (not an error) when nothing is claimable', async () => {
    await initBoard(AUTH, 'brd_empty', RESEARCH_PIPELINE);
    const client = await connectMcp(depsFor(AUTH));
    const res = await client.callTool({ name: 'kaambaan_claim_card', arguments: { boardId: 'brd_empty' } });

    expect(res.isError).toBeFalsy();
    expect(toolJson(res)).toEqual({ claimed: false });
  });

  it('completes a run and advances the card to the next stage', async () => {
    await initBoard(AUTH, 'brd_done', RESEARCH_PIPELINE);
    const stub = depsFor(AUTH).boardStub('brd_done');
    await stub.createCard({ title: 'Ship it', ownerUserId: 'usr_a' });

    const client = await connectMcp(depsFor(AUTH));
    const claim = toolJson(await client.callTool({ name: 'kaambaan_claim_card', arguments: { boardId: 'brd_done' } })) as {
      runId: string;
      leaseEpoch: number;
    };
    const res = await client.callTool({
      name: 'kaambaan_complete',
      arguments: { boardId: 'brd_done', runId: claim.runId, leaseEpoch: claim.leaseEpoch, handoff: { summary: 'drafted' } },
    });
    const card = toolJson(res) as { currentStageKey: string; state: string };

    expect(res.isError).toBeFalsy();
    expect(card.currentStageKey).toBe('review');
    expect(card.state).toBe('input-required');
  });

  it('returns isError on a business failure (stale lease) so the model can self-correct', async () => {
    await initBoard(AUTH, 'brd_stale', RESEARCH_PIPELINE);
    const stub = depsFor(AUTH).boardStub('brd_stale');
    await stub.createCard({ title: 'Card', ownerUserId: 'usr_a' });
    const client = await connectMcp(depsFor(AUTH));
    const claim = toolJson(await client.callTool({ name: 'kaambaan_claim_card', arguments: { boardId: 'brd_stale' } })) as {
      runId: string;
      leaseEpoch: number;
    };

    const res = await client.callTool({
      name: 'kaambaan_complete',
      arguments: { boardId: 'brd_stale', runId: claim.runId, leaseEpoch: claim.leaseEpoch + 99 },
    });

    expect(res.isError).toBe(true);
    expect((res.content as Array<{ text: string }>)[0]!.text).toContain('STALE_LEASE');
  });
});
