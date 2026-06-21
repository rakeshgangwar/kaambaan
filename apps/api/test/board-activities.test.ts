import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BoardDO, type BoardInit } from '../src/board/board-do';

const PIPE: BoardInit['stages'] = [
  { key: 'research', name: 'Research', order: 0, ownerKind: 'capability', owner: 'research' },
  { key: 'review', name: 'Review', order: 1, ownerKind: 'human', gate: 'approval' },
];

function stubFor(name: string): DurableObjectStub<BoardDO> {
  return env.BOARD_DO.get(env.BOARD_DO.idFromName(name)) as unknown as DurableObjectStub<BoardDO>;
}

describe('BoardDO — card activity timeline (docs/07 §4)', () => {
  it('returns the durable activity waterfall plus the carried handoff', async () => {
    await runInDurableObject(stubFor('act-timeline'), async (board: BoardDO) => {
      await board.init({ id: 'brd_a', tenantId: 'tnt_a', name: 'A', stages: PIPE });
      const c = await board.createCard({ title: 'Write the post', ownerUserId: 'usr_a' });
      if (!c.ok) throw new Error('card');
      const cardId = c.value.id;
      const run = await board.claim({ agentId: 'agt_r', capabilities: ['research'] });
      if (!run.claimed) throw new Error('claim');

      await board.postActivity({ runId: run.runId, leaseEpoch: run.leaseEpoch, type: 'thought', body: 'planning the outline' });
      await board.postActivity({ runId: run.runId, leaseEpoch: run.leaseEpoch, type: 'action', action: 'web.fetch', parameter: { url: 'https://x.y' } });
      await board.postActivity({ runId: run.runId, leaseEpoch: run.leaseEpoch, type: 'thought', body: 'scratch', ephemeral: true }); // transient — excluded
      await board.postActivity({ runId: run.runId, leaseEpoch: run.leaseEpoch, type: 'response', body: 'drafted ~850 words' });
      await board.complete({ runId: run.runId, leaseEpoch: run.leaseEpoch, handoff: { summary: 'drafted the post', next: 'review' } });

      const detail = await board.getCardActivities(cardId);
      expect(detail.activities).toHaveLength(3); // ephemeral one excluded
      expect(detail.activities.map((a) => a.type)).toEqual(['thought', 'action', 'response']);
      expect(detail.activities[0]!.body).toBe('planning the outline');
      expect(detail.activities[1]).toMatchObject({ action: 'web.fetch', parameter: { url: 'https://x.y' } });
      expect(detail.activities[0]!.runId).toBe(run.runId);
      // the handoff carried into the card from the completed stage
      expect(detail.handoff).toMatchObject({ summary: 'drafted the post', next: 'review' });
    });
  });

  it('returns an empty timeline for an untouched card', async () => {
    await runInDurableObject(stubFor('act-empty'), async (board: BoardDO) => {
      await board.init({ id: 'brd_e', tenantId: 'tnt_a', name: 'E', stages: PIPE });
      const c = await board.createCard({ title: 'Fresh', ownerUserId: 'usr_a' });
      if (!c.ok) throw new Error('card');
      const detail = await board.getCardActivities(c.value.id);
      expect(detail.activities).toEqual([]);
      expect(detail.handoff).toBeNull();
    });
  });
});
