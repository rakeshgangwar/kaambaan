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

describe('BoardDO — countReadyForCapabilities (agent work discovery)', () => {
  it('counts cards ready in stages the capabilities can claim, and drops claimed ones', async () => {
    await runInDurableObject(stubFor('cnt-1'), async (board: BoardDO) => {
      await board.init({ id: 'brd_c', tenantId: 'tnt_a', name: 'C', stages: PIPE });
      for (const t of ['One', 'Two', 'Three']) {
        const r = await board.createCard({ title: t, ownerUserId: 'usr_a' });
        if (!r.ok) throw new Error('card');
      }
      // three cards sit ready in the research (capability) stage
      expect(await board.countReadyForCapabilities('agt_r', ['research'])).toBe(3);
      // a capability with no matching stage sees nothing
      expect(await board.countReadyForCapabilities('agt_x', ['design'])).toBe(0);

      // claiming one makes it 'working' → no longer counted as ready
      const run = await board.claim({ agentId: 'agt_r', capabilities: ['research'] });
      if (!run.claimed) throw new Error('claim');
      expect(await board.countReadyForCapabilities('agt_r', ['research'])).toBe(2);
    });
  });

  it('returns 0 for an uninitialized board', async () => {
    await runInDurableObject(stubFor('cnt-empty'), async (board: BoardDO) => {
      expect(await board.countReadyForCapabilities('agt_r', ['research'])).toBe(0);
    });
  });
});
