import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BoardDO, type BoardInit, type CardView } from '../src/board/board-do';

// A two-stage agent pipeline: a 'research' agent works stage 1, a 'build' agent works stage 2.
const PIPELINE: BoardInit['stages'] = [
  { key: 'research', name: 'Research', order: 0, ownerKind: 'capability', owner: 'research' },
  { key: 'build', name: 'Build', order: 1, ownerKind: 'capability', owner: 'build' },
];

const init = (id = 'brd_agent'): BoardInit => ({
  id,
  tenantId: 'tnt_a',
  name: 'Agents',
  stages: PIPELINE,
});

function stubFor(name: string): DurableObjectStub<BoardDO> {
  return env.BOARD_DO.get(env.BOARD_DO.idFromName(name)) as unknown as DurableObjectStub<BoardDO>;
}

async function mustCreate(board: BoardDO, title: string): Promise<CardView> {
  const r = await board.createCard({ title, ownerUserId: 'usr_a' });
  if (!r.ok) throw new Error(`createCard failed: ${r.message}`);
  return r.value;
}

const RESEARCHER = { agentId: 'agt_r', capabilities: ['research'] };
const BUILDER = { agentId: 'agt_b', capabilities: ['build'] };
const FAR_FUTURE = 8_000_000_000_000; // well past any heartbeat deadline

describe('BoardDO — claim', () => {
  it('a matching agent atomically claims a ready card', async () => {
    await runInDurableObject(stubFor('claim-match'), async (board: BoardDO) => {
      await board.init(init());
      await mustCreate(board, 'Summarize incidents');
      const r = await board.claim(RESEARCHER);
      expect(r.claimed).toBe(true);
      if (r.claimed) {
        expect(r.runId).toMatch(/^run_/);
        expect(r.leaseEpoch).toBe(1);
        expect(r.card.state).toBe('working');
        expect(r.card.delegateAgentId).toBe('agt_r');
        expect(r.stage.key).toBe('research');
      }
    });
  });

  it('an agent without the stage capability gets nothing', async () => {
    await runInDurableObject(stubFor('claim-nomatch'), async (board: BoardDO) => {
      await board.init(init());
      await mustCreate(board, 'A');
      const r = await board.claim({ agentId: 'agt_x', capabilities: ['design'] });
      expect(r.claimed).toBe(false);
    });
  });

  it('returns nothing when there are no ready cards', async () => {
    await runInDurableObject(stubFor('claim-empty'), async (board: BoardDO) => {
      await board.init(init());
      const r = await board.claim(RESEARCHER);
      expect(r.claimed).toBe(false);
    });
  });

  it('enforces the agent concurrency limit', async () => {
    await runInDurableObject(stubFor('claim-concurrency'), async (board: BoardDO) => {
      await board.init(init());
      await mustCreate(board, 'A');
      await mustCreate(board, 'B');
      const first = await board.claim({ ...RESEARCHER, maxConcurrency: 1 });
      expect(first.claimed).toBe(true);
      const second = await board.claim({ ...RESEARCHER, maxConcurrency: 1 });
      expect(second.claimed).toBe(false); // already at limit
    });
  });

  it('hands two different cards to two agents', async () => {
    await runInDurableObject(stubFor('claim-two'), async (board: BoardDO) => {
      await board.init(init());
      await mustCreate(board, 'A');
      await mustCreate(board, 'B');
      const a = await board.claim({ agentId: 'agt_1', capabilities: ['research'] });
      const b = await board.claim({ agentId: 'agt_2', capabilities: ['research'] });
      expect(a.claimed && b.claimed).toBe(true);
      if (a.claimed && b.claimed) expect(a.card.id).not.toBe(b.card.id);
    });
  });
});

describe('BoardDO — heartbeat & lease', () => {
  it('acknowledges a valid heartbeat', async () => {
    await runInDurableObject(stubFor('hb-ok'), async (board: BoardDO) => {
      await board.init(init());
      await mustCreate(board, 'A');
      const c = await board.claim(RESEARCHER);
      if (!c.claimed) throw new Error('expected claim');
      const r = await board.heartbeat({ runId: c.runId, leaseEpoch: c.leaseEpoch });
      expect(r.ok).toBe(true);
    });
  });

  it('rejects a heartbeat with a stale lease epoch', async () => {
    await runInDurableObject(stubFor('hb-stale'), async (board: BoardDO) => {
      await board.init(init());
      await mustCreate(board, 'A');
      const c = await board.claim(RESEARCHER);
      if (!c.claimed) throw new Error('expected claim');
      const r = await board.heartbeat({ runId: c.runId, leaseEpoch: c.leaseEpoch + 99 });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('STALE_LEASE');
    });
  });
});

describe('BoardDO — activity', () => {
  it('records a thought without changing card state', async () => {
    await runInDurableObject(stubFor('act-thought'), async (board: BoardDO) => {
      await board.init(init());
      await mustCreate(board, 'A');
      const c = await board.claim(RESEARCHER);
      if (!c.claimed) throw new Error('expected claim');
      const r = await board.postActivity({
        runId: c.runId,
        leaseEpoch: c.leaseEpoch,
        type: 'thought',
        body: 'thinking…',
        ephemeral: true,
      });
      expect(r.ok).toBe(true);
      const state = await board.getState();
      expect(state.cards[0]!.state).toBe('working');
    });
  });

  it('an elicitation moves the card to input-required', async () => {
    await runInDurableObject(stubFor('act-elicit'), async (board: BoardDO) => {
      await board.init(init());
      await mustCreate(board, 'A');
      const c = await board.claim(RESEARCHER);
      if (!c.claimed) throw new Error('expected claim');
      await board.postActivity({
        runId: c.runId,
        leaseEpoch: c.leaseEpoch,
        type: 'elicitation',
        body: 'Which repo?',
      });
      const state = await board.getState();
      expect(state.cards[0]!.state).toBe('input-required');
    });
  });
});

describe('BoardDO — complete & handoff', () => {
  it('completing a stage advances the card and passes handoff to the next stage', async () => {
    await runInDurableObject(stubFor('complete-advance'), async (board: BoardDO) => {
      await board.init(init());
      await mustCreate(board, 'A');
      const c = await board.claim(RESEARCHER);
      if (!c.claimed) throw new Error('expected claim');
      const done = await board.complete({
        runId: c.runId,
        leaseEpoch: c.leaseEpoch,
        handoff: { summary: 'researched' },
      });
      expect(done.ok).toBe(true);
      if (done.ok) {
        expect(done.value.currentStageKey).toBe('build');
        expect(done.value.state).toBe('submitted');
        expect(done.value.delegateAgentId).toBeNull();
      }
      // the build agent picks it up and receives the handoff
      const next = await board.claim(BUILDER);
      expect(next.claimed).toBe(true);
      if (next.claimed) expect(next.handoff).toEqual({ summary: 'researched' });
    });
  });

  it('completing the last stage marks the card done', async () => {
    await runInDurableObject(stubFor('complete-final'), async (board: BoardDO) => {
      await board.init(init());
      await mustCreate(board, 'A');
      const c1 = await board.claim(RESEARCHER);
      if (!c1.claimed) throw new Error('expected claim');
      await board.complete({ runId: c1.runId, leaseEpoch: c1.leaseEpoch });
      const c2 = await board.claim(BUILDER);
      if (!c2.claimed) throw new Error('expected claim');
      const final = await board.complete({ runId: c2.runId, leaseEpoch: c2.leaseEpoch });
      expect(final.ok).toBe(true);
      if (final.ok) expect(final.value.state).toBe('completed');
    });
  });
});

describe('BoardDO — block / fail / release & circuit breaker', () => {
  it('block parks the card for a human', async () => {
    await runInDurableObject(stubFor('block'), async (board: BoardDO) => {
      await board.init(init());
      await mustCreate(board, 'A');
      const c = await board.claim(RESEARCHER);
      if (!c.claimed) throw new Error('expected claim');
      const r = await board.block({ runId: c.runId, leaseEpoch: c.leaseEpoch, reason: 'need access' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.state).toBe('input-required');
        expect(r.value.delegateAgentId).toBeNull();
      }
    });
  });

  it('release returns the card to ready without a failure', async () => {
    await runInDurableObject(stubFor('release'), async (board: BoardDO) => {
      await board.init(init());
      await mustCreate(board, 'A');
      const c = await board.claim(RESEARCHER);
      if (!c.claimed) throw new Error('expected claim');
      const r = await board.release({ runId: c.runId, leaseEpoch: c.leaseEpoch });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.state).toBe('submitted');
      // claimable again
      const again = await board.claim(RESEARCHER);
      expect(again.claimed).toBe(true);
    });
  });

  it('fail returns the card to ready, then the circuit breaker blocks it', async () => {
    await runInDurableObject(stubFor('breaker'), async (board: BoardDO) => {
      await board.init(init());
      await mustCreate(board, 'A');
      const c1 = await board.claim(RESEARCHER);
      if (!c1.claimed) throw new Error('expected claim');
      const f1 = await board.fail({ runId: c1.runId, leaseEpoch: c1.leaseEpoch, reason: 'boom' });
      expect(f1.ok && f1.value.state).toBe('submitted'); // retryable after one failure

      const c2 = await board.claim(RESEARCHER);
      if (!c2.claimed) throw new Error('expected re-claim');
      const f2 = await board.fail({ runId: c2.runId, leaseEpoch: c2.leaseEpoch, reason: 'boom again' });
      expect(f2.ok).toBe(true);
      if (f2.ok) expect(f2.value.state).toBe('input-required'); // breaker tripped
    });
  });
});

describe('BoardDO — heartbeat-timeout reclaim', () => {
  it('reclaims a run whose heartbeat lapsed and frees the card', async () => {
    await runInDurableObject(stubFor('reclaim'), async (board: BoardDO) => {
      await board.init(init());
      await mustCreate(board, 'A');
      const c = await board.claim(RESEARCHER);
      if (!c.claimed) throw new Error('expected claim');

      const reclaimed = await board.reclaimExpired(FAR_FUTURE);
      expect(reclaimed).toBe(1);

      const state = await board.getState();
      expect(state.cards[0]!.state).toBe('submitted');
      expect(state.cards[0]!.delegateAgentId).toBeNull();

      // the zombie agent's lease is now stale
      const hb = await board.heartbeat({ runId: c.runId, leaseEpoch: c.leaseEpoch });
      expect(hb.ok).toBe(false);
      if (!hb.ok) expect(hb.code).toBe('STALE_LEASE');
    });
  });

  it('does not reclaim a run with a fresh heartbeat', async () => {
    await runInDurableObject(stubFor('reclaim-fresh'), async (board: BoardDO) => {
      await board.init(init());
      await mustCreate(board, 'A');
      const c = await board.claim(RESEARCHER);
      if (!c.claimed) throw new Error('expected claim');
      const reclaimed = await board.reclaimExpired(0); // "now" = epoch 0, nothing is overdue
      expect(reclaimed).toBe(0);
      const state = await board.getState();
      expect(state.cards[0]!.state).toBe('working');
    });
  });
});
