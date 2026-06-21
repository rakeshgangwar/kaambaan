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
});
