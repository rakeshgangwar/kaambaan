import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BoardDO, type BoardInit } from '../src/board/board-do';

const PIPELINE: BoardInit['stages'] = [{ key: 'build', name: 'Build', order: 0, ownerKind: 'capability', owner: 'build' }];

function stubFor(name: string): DurableObjectStub<BoardDO> {
  return env.BOARD_DO.get(env.BOARD_DO.idFromName(name)) as unknown as DurableObjectStub<BoardDO>;
}

describe('BoardDO — attempts (docs/07 §5)', () => {
  it('lists each run as an attempt with its agent, model, and cost', async () => {
    await runInDurableObject(stubFor('at-list'), async (board: BoardDO) => {
      await board.init({ id: 'brd_at', tenantId: 'tnt_a', name: 'AT', stages: PIPELINE });
      const c = await board.createCard({ title: 'Build it', ownerUserId: 'usr_a' });
      if (!c.ok) throw new Error('card');
      const cardId = c.value.id;

      // Attempt 1: claimed, billed, then failed → card returns to the queue.
      const run1 = await board.claim({ agentId: 'agt_opus', capabilities: ['build'] });
      if (!run1.claimed) throw new Error('claim1');
      await board.postActivity({ runId: run1.runId, leaseEpoch: run1.leaseEpoch, type: 'action', usage: { model: 'claude-opus-4-8', costUsd: 0.5 } });
      await board.fail({ runId: run1.runId, leaseEpoch: run1.leaseEpoch, reason: 'flaky' });

      // Attempt 2: re-claimed by a different agent, no usage yet.
      const run2 = await board.claim({ agentId: 'agt_sonnet', capabilities: ['build'] });
      if (!run2.claimed) throw new Error('claim2');

      const attempts = await board.getAttempts(cardId);
      expect(attempts).toHaveLength(2);
      expect(attempts[0]).toMatchObject({ runId: run1.runId, agentId: 'agt_opus', model: 'claude-opus-4-8' });
      expect(attempts[0]!.costUsd).toBeCloseTo(0.5, 6);
      expect(attempts[0]!.endedAt).not.toBeNull();
      expect(attempts[1]).toMatchObject({ runId: run2.runId, agentId: 'agt_sonnet', costUsd: 0, model: null });
      expect(attempts[1]!.endedAt).toBeNull();

      // The card surfaces its attempt count for the board view.
      expect((await board.getState()).cards.find((x) => x.id === cardId)?.attemptCount).toBe(2);
    });
  });

  it('returns no attempts for a card that was never claimed', async () => {
    await runInDurableObject(stubFor('at-none'), async (board: BoardDO) => {
      await board.init({ id: 'brd_at2', tenantId: 'tnt_a', name: 'AT2', stages: PIPELINE });
      const c = await board.createCard({ title: 'Untouched', ownerUserId: 'usr_a' });
      if (!c.ok) throw new Error('card');
      expect(await board.getAttempts(c.value.id)).toEqual([]);
      expect((await board.getState()).cards[0]?.attemptCount).toBe(0);
    });
  });
});
