import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BoardDO, type BoardInit, type CardView } from '../src/board/board-do';

// research (agent) → review (human approval gate) → publish (agent)
const REVIEW_PIPELINE: BoardInit['stages'] = [
  { key: 'research', name: 'Research', order: 0, ownerKind: 'capability', owner: 'research' },
  { key: 'review', name: 'Review', order: 1, ownerKind: 'human', gate: 'approval' },
  { key: 'publish', name: 'Publish', order: 2, ownerKind: 'capability', owner: 'publish' },
];

// build (agent-worked AND gated → submit-for-review) → ship (agent)
const SUBMIT_PIPELINE: BoardInit['stages'] = [
  { key: 'build', name: 'Build', order: 0, ownerKind: 'capability', owner: 'build', gate: 'approval' },
  { key: 'ship', name: 'Ship', order: 1, ownerKind: 'capability', owner: 'ship' },
];

function stubFor(name: string): DurableObjectStub<BoardDO> {
  return env.BOARD_DO.get(env.BOARD_DO.idFromName(name)) as unknown as DurableObjectStub<BoardDO>;
}

async function mustCreate(board: BoardDO, title: string): Promise<CardView> {
  const r = await board.createCard({ title, ownerUserId: 'usr_a' });
  if (!r.ok) throw new Error(r.message);
  return r.value;
}

/** Drive research→complete so the card lands on the review gate. Returns the gate id. */
async function openReviewGate(board: BoardDO): Promise<{ cardId: string; gateId: string }> {
  await board.init({ id: 'brd_g', tenantId: 'tnt_a', name: 'Gated', stages: REVIEW_PIPELINE });
  const card = await mustCreate(board, 'Write the post');
  const c = await board.claim({ agentId: 'agt_r', capabilities: ['research'] });
  if (!c.claimed) throw new Error('expected research claim');
  await board.complete({ runId: c.runId, leaseEpoch: c.leaseEpoch, handoff: { summary: 'drafted' } });
  const gates = (await board.getState()).gates;
  if (gates.length !== 1) throw new Error(`expected one gate, got ${gates.length}`);
  return { cardId: card.id, gateId: gates[0]!.id };
}

describe('BoardDO — approval gates', () => {
  it('opens a gate when a card advances into a human review stage', async () => {
    await runInDurableObject(stubFor('g-open'), async (board: BoardDO) => {
      await openReviewGate(board);
      const state = await board.getState();
      expect(state.cards[0]!.currentStageKey).toBe('review');
      expect(state.cards[0]!.state).toBe('input-required');
      expect(state.gates[0]!.stageKey).toBe('review');
      // a gated card is not claimable by any agent
      expect((await board.claim({ agentId: 'agt_p', capabilities: ['publish'] })).claimed).toBe(false);
      expect((await board.claim({ agentId: 'agt_r', capabilities: ['research'] })).claimed).toBe(false);
    });
  });

  it('approve advances the card past the gate, carrying the handoff', async () => {
    await runInDurableObject(stubFor('g-approve'), async (board: BoardDO) => {
      const { gateId } = await openReviewGate(board);
      const r = await board.resolveGate({ gateId, decision: 'approve', decidedBy: 'usr_x' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.currentStageKey).toBe('publish');
        expect(r.value.state).toBe('submitted');
      }
      const next = await board.claim({ agentId: 'agt_p', capabilities: ['publish'] });
      expect(next.claimed).toBe(true);
      if (next.claimed) expect(next.handoff).toEqual({ summary: 'drafted' });
    });
  });

  it('request_changes sends the card back to the prior stage with feedback', async () => {
    await runInDurableObject(stubFor('g-changes'), async (board: BoardDO) => {
      const { gateId } = await openReviewGate(board);
      const r = await board.resolveGate({
        gateId,
        decision: 'request_changes',
        decidedBy: 'usr_x',
        comment: 'tighten the intro',
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.currentStageKey).toBe('research');
        expect(r.value.state).toBe('submitted');
      }
      const again = await board.claim({ agentId: 'agt_r', capabilities: ['research'] });
      expect(again.claimed).toBe(true);
      // the reworking agent keeps its prior handoff AND gets the reviewer's feedback
      if (again.claimed) expect(again.handoff).toEqual({ summary: 'drafted', feedback: 'tighten the intro' });
    });
  });

  it('reject marks the card rejected', async () => {
    await runInDurableObject(stubFor('g-reject'), async (board: BoardDO) => {
      const { gateId } = await openReviewGate(board);
      const r = await board.resolveGate({ gateId, decision: 'reject', decidedBy: 'usr_x' });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.state).toBe('rejected');
    });
  });

  it('enforces separation of duties — the producer cannot resolve their own gate', async () => {
    await runInDurableObject(stubFor('g-sod'), async (board: BoardDO) => {
      const { gateId } = await openReviewGate(board);
      const r = await board.resolveGate({ gateId, decision: 'approve', decidedBy: 'agt_r' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('SEPARATION_OF_DUTIES');
    });
  });

  it('rejects an unknown gate and a double-resolve', async () => {
    await runInDurableObject(stubFor('g-errors'), async (board: BoardDO) => {
      const { gateId } = await openReviewGate(board);
      const missing = await board.resolveGate({ gateId: 'gate_nope', decision: 'approve', decidedBy: 'usr_x' });
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.code).toBe('GATE_NOT_FOUND');

      await board.resolveGate({ gateId, decision: 'approve', decidedBy: 'usr_x' });
      const again = await board.resolveGate({ gateId, decision: 'approve', decidedBy: 'usr_y' });
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.code).toBe('GATE_NOT_PENDING');
    });
  });

  it('submitForReview opens a gate at an agent-worked gated stage', async () => {
    await runInDurableObject(stubFor('g-submit'), async (board: BoardDO) => {
      await board.init({ id: 'brd_s', tenantId: 'tnt_a', name: 'Submit', stages: SUBMIT_PIPELINE });
      await mustCreate(board, 'Build the thing');
      // build is capability-owned, so the card enters 'build' as claimable (gate fires on submit, not entry)
      const c = await board.claim({ agentId: 'agt_build', capabilities: ['build'] });
      expect(c.claimed).toBe(true);
      if (!c.claimed) return;
      const sub = await board.submitForReview({ runId: c.runId, leaseEpoch: c.leaseEpoch });
      expect(sub.ok).toBe(true);
      if (sub.ok) expect(sub.value.state).toBe('input-required');

      const gate = (await board.getState()).gates[0]!;
      expect(gate.stageKey).toBe('build');
      const r = await board.resolveGate({ gateId: gate.id, decision: 'approve', decidedBy: 'usr_x' });
      expect(r.ok && r.value.currentStageKey).toBe('ship');
    });
  });

  it('separation of duties holds across chained gates', async () => {
    await runInDurableObject(stubFor('g-chained'), async (board: BoardDO) => {
      await board.init({
        id: 'brd_c',
        tenantId: 'tnt_a',
        name: 'Chained',
        stages: [
          { key: 'research', name: 'Research', order: 0, ownerKind: 'capability', owner: 'research' },
          { key: 'review1', name: 'Review 1', order: 1, ownerKind: 'human', gate: 'approval' },
          { key: 'review2', name: 'Review 2', order: 2, ownerKind: 'human', gate: 'approval' },
          { key: 'publish', name: 'Publish', order: 3, ownerKind: 'capability', owner: 'publish' },
        ],
      });
      await mustCreate(board, 'Doc');
      const c = await board.claim({ agentId: 'agt_r', capabilities: ['research'] });
      if (!c.claimed) throw new Error('expected claim');
      await board.complete({ runId: c.runId, leaseEpoch: c.leaseEpoch });

      // usr_x approves the first gate → the second gate opens with usr_x as its producer.
      let gate = (await board.getState()).gates[0]!;
      expect((await board.resolveGate({ gateId: gate.id, decision: 'approve', decidedBy: 'usr_x' })).ok).toBe(true);
      gate = (await board.getState()).gates[0]!;
      expect(gate.stageKey).toBe('review2');

      // usr_x cannot approve the gate they just produced…
      const self = await board.resolveGate({ gateId: gate.id, decision: 'approve', decidedBy: 'usr_x' });
      expect(self.ok).toBe(false);
      if (!self.ok) expect(self.code).toBe('SEPARATION_OF_DUTIES');

      // …but a different reviewer can.
      const other = await board.resolveGate({ gateId: gate.id, decision: 'approve', decidedBy: 'usr_y' });
      expect(other.ok && other.value.currentStageKey).toBe('publish');
    });
  });
});
