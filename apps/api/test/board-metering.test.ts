import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BoardDO, type BoardInit } from '../src/board/board-do';

const PIPELINE: BoardInit['stages'] = [{ key: 'build', name: 'Build', order: 0, ownerKind: 'capability', owner: 'build' }];

function stubFor(name: string): DurableObjectStub<BoardDO> {
  return env.BOARD_DO.get(env.BOARD_DO.idFromName(name)) as unknown as DurableObjectStub<BoardDO>;
}

async function claimCard(board: BoardDO, title = 'C'): Promise<{ cardId: string; runId: string; leaseEpoch: number }> {
  const c = await board.createCard({ title, ownerUserId: 'usr_a' });
  if (!c.ok) throw new Error('card');
  const claim = await board.claim({ agentId: 'agt_b', capabilities: ['build'] });
  if (!claim.claimed) throw new Error('claim');
  return { cardId: c.value.id, runId: claim.runId, leaseEpoch: claim.leaseEpoch };
}

describe('BoardDO — metering & budgets (docs/07 §6)', () => {
  it('records reported usage into per-card and board totals', async () => {
    await runInDurableObject(stubFor('m-record'), async (board: BoardDO) => {
      await board.init({ id: 'brd_m', tenantId: 'tnt_a', name: 'M', stages: PIPELINE });
      const { cardId, runId, leaseEpoch } = await claimCard(board);
      await board.postActivity({
        runId,
        leaseEpoch,
        type: 'action',
        usage: { model: 'claude-opus-4-8', inputTokens: 1000, outputTokens: 500, costUsd: 0.25 },
      });

      const snap = await board.getState();
      expect(snap.cards.find((c) => c.id === cardId)?.costUsd).toBeCloseTo(0.25, 6);
      expect(snap.usage.totalCostUsd).toBeCloseTo(0.25, 6);

      const usage = await board.getUsage();
      expect(usage.totalCostUsd).toBeCloseTo(0.25, 6);
      expect(usage.byModel.find((m) => m.model === 'claude-opus-4-8')?.costUsd).toBeCloseTo(0.25, 6);
    });
  });

  it('estimates cost from model pricing when the agent does not report it', async () => {
    await runInDurableObject(stubFor('m-estimate'), async (board: BoardDO) => {
      await board.init({ id: 'brd_e', tenantId: 'tnt_a', name: 'E', stages: PIPELINE });
      const { cardId, runId, leaseEpoch } = await claimCard(board);
      // Sonnet 4.6 = $3/Mtok in → 1M input tokens = $3, no costUsd reported.
      await board.postActivity({ runId, leaseEpoch, type: 'action', usage: { model: 'claude-sonnet-4-6', inputTokens: 1_000_000, outputTokens: 0 } });

      const snap = await board.getState();
      expect(snap.cards.find((c) => c.id === cardId)?.costUsd).toBeCloseTo(3, 5);
      const usage = await board.getUsage();
      expect(usage.estimatedCostUsd).toBeCloseTo(3, 5); // tracked separately so operators see what's estimated
    });
  });

  it('aggregates usage by model and by agent', async () => {
    await runInDurableObject(stubFor('m-agg'), async (board: BoardDO) => {
      await board.init({ id: 'brd_a', tenantId: 'tnt_a', name: 'A', stages: PIPELINE });
      const a = await claimCard(board, 'A');
      await board.postActivity({ runId: a.runId, leaseEpoch: a.leaseEpoch, type: 'action', usage: { model: 'claude-opus-4-8', inputTokens: 0, outputTokens: 0, costUsd: 1 } });
      await board.postActivity({ runId: a.runId, leaseEpoch: a.leaseEpoch, type: 'action', usage: { model: 'claude-haiku-4-5', inputTokens: 0, outputTokens: 0, costUsd: 0.1 } });

      const usage = await board.getUsage();
      expect(usage.totalCostUsd).toBeCloseTo(1.1, 6);
      expect(usage.byModel).toHaveLength(2);
      expect(usage.byAgent.find((x) => x.agentId === 'agt_b')?.costUsd).toBeCloseTo(1.1, 6);
    });
  });

  it('flags a card that exceeds its per-card budget cap', async () => {
    await runInDurableObject(stubFor('m-cardcap'), async (board: BoardDO) => {
      await board.init({ id: 'brd_cc', tenantId: 'tnt_a', name: 'CC', stages: PIPELINE });
      await board.setBudget({ cardUsdCap: 1 });
      const { cardId, runId, leaseEpoch } = await claimCard(board);
      await board.postActivity({ runId, leaseEpoch, type: 'action', usage: { model: 'claude-opus-4-8', inputTokens: 0, outputTokens: 0, costUsd: 2 } });

      const snap = await board.getState();
      expect(snap.cards.find((c) => c.id === cardId)?.overBudget).toBe(true);
    });
  });

  it('blocks new claims once the board budget cap is exceeded', async () => {
    await runInDurableObject(stubFor('m-boardcap'), async (board: BoardDO) => {
      await board.init({ id: 'brd_bc', tenantId: 'tnt_a', name: 'BC', stages: PIPELINE });
      await board.setBudget({ boardUsdCap: 1 });
      const a = await claimCard(board, 'A');
      await board.postActivity({ runId: a.runId, leaseEpoch: a.leaseEpoch, type: 'action', usage: { model: 'claude-opus-4-8', inputTokens: 0, outputTokens: 0, costUsd: 2 } });
      await board.complete({ runId: a.runId, leaseEpoch: a.leaseEpoch });

      await board.createCard({ title: 'B', ownerUserId: 'usr_a' });
      const blocked = await board.claim({ agentId: 'agt_b', capabilities: ['build'] });
      expect(blocked.claimed).toBe(false);

      const snap = await board.getState();
      expect(snap.usage.overBudget).toBe(true);
      expect(snap.usage.budgetUsd).toBe(1);
    });
  });

  it('rejects invalid usage (negative or non-finite cost)', async () => {
    await runInDurableObject(stubFor('m-invalid'), async (board: BoardDO) => {
      await board.init({ id: 'brd_inv', tenantId: 'tnt_a', name: 'I', stages: PIPELINE });
      const { runId, leaseEpoch } = await claimCard(board);
      const r = await board.postActivity({ runId, leaseEpoch, type: 'action', usage: { costUsd: -5 } });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('INVALID_USAGE');
    });
  });

  it('stops an in-flight run from billing past its per-card cap', async () => {
    await runInDurableObject(stubFor('m-inflight'), async (board: BoardDO) => {
      await board.init({ id: 'brd_if', tenantId: 'tnt_a', name: 'IF', stages: PIPELINE });
      await board.setBudget({ cardUsdCap: 1 });
      const { runId, leaseEpoch } = await claimCard(board);
      // The activity that crosses the cap is allowed (overrun bounded to one activity)…
      const crossing = await board.postActivity({ runId, leaseEpoch, type: 'action', usage: { costUsd: 1.5 } });
      expect(crossing.ok).toBe(true);
      // …the next billable activity is rejected.
      const over = await board.postActivity({ runId, leaseEpoch, type: 'action', usage: { costUsd: 0.5 } });
      expect(over.ok).toBe(false);
      if (!over.ok) expect(over.code).toBe('BUDGET_EXCEEDED');
    });
  });

  it('resumes claims after the board cap is cleared', async () => {
    await runInDurableObject(stubFor('m-resume'), async (board: BoardDO) => {
      await board.init({ id: 'brd_rs', tenantId: 'tnt_a', name: 'RS', stages: PIPELINE });
      await board.setBudget({ boardUsdCap: 1 });
      const a = await claimCard(board, 'A');
      await board.postActivity({ runId: a.runId, leaseEpoch: a.leaseEpoch, type: 'action', usage: { costUsd: 2 } });
      await board.complete({ runId: a.runId, leaseEpoch: a.leaseEpoch });
      await board.createCard({ title: 'B', ownerUserId: 'usr_a' });

      expect((await board.claim({ agentId: 'agt_b', capabilities: ['build'] })).claimed).toBe(false);
      await board.setBudget({ boardUsdCap: null }); // clear the cap
      expect((await board.claim({ agentId: 'agt_b', capabilities: ['build'] })).claimed).toBe(true);
    });
  });

  it('supports a rolling-window filter on usage', async () => {
    await runInDurableObject(stubFor('m-window'), async (board: BoardDO) => {
      await board.init({ id: 'brd_win', tenantId: 'tnt_a', name: 'W', stages: PIPELINE });
      const { runId, leaseEpoch } = await claimCard(board);
      await board.postActivity({ runId, leaseEpoch, type: 'action', usage: { costUsd: 1 } });
      expect((await board.getUsage({ window: '5h' })).totalCostUsd).toBeCloseTo(1, 6); // recent included
      expect((await board.getUsage({ window: 'bogus' })).totalCostUsd).toBeCloseTo(1, 6); // bad window → full rollup
    });
  });

  it('estimates a stage cost from historical runs', async () => {
    await runInDurableObject(stubFor('m-estimate-stage'), async (board: BoardDO) => {
      await board.init({ id: 'brd_es', tenantId: 'tnt_a', name: 'ES', stages: PIPELINE });
      // Two historical runs at 'build': $1 and $3 → average $2.
      for (const cost of [1, 3]) {
        const c = await board.createCard({ title: 'h', ownerUserId: 'usr_a' });
        if (!c.ok) throw new Error('card');
        const run = await board.claim({ agentId: 'agt_b', capabilities: ['build'] });
        if (!run.claimed) throw new Error('claim');
        await board.postActivity({ runId: run.runId, leaseEpoch: run.leaseEpoch, type: 'action', usage: { costUsd: cost } });
        await board.complete({ runId: run.runId, leaseEpoch: run.leaseEpoch });
      }
      const fresh = await board.createCard({ title: 'new', ownerUserId: 'usr_a' });
      if (!fresh.ok) throw new Error('card');
      const est = await board.estimateCardCost(fresh.value.id);
      expect(est.ok).toBe(true);
      if (est.ok) {
        expect(est.value.estimatedUsd).toBeCloseTo(2, 6);
        expect(est.value.sampleSize).toBe(2);
      }
    });
  });

  it('returns no estimate when a stage has no history', async () => {
    await runInDurableObject(stubFor('m-estimate-none'), async (board: BoardDO) => {
      await board.init({ id: 'brd_en', tenantId: 'tnt_a', name: 'EN', stages: PIPELINE });
      const c = await board.createCard({ title: 'first', ownerUserId: 'usr_a' });
      if (!c.ok) throw new Error('card');
      const est = await board.estimateCardCost(c.value.id);
      expect(est.ok && est.value.estimatedUsd).toBeNull();
      expect(est.ok && est.value.sampleSize).toBe(0);
    });
  });
});
