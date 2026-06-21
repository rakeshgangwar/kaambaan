import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BoardDO, type BoardInit } from '../src/board/board-do';

const PIPELINE: BoardInit['stages'] = [
  { key: 'backlog', name: 'Backlog', order: 0 },
  { key: 'build', name: 'Build', order: 1, ownerKind: 'capability', owner: 'build' },
];

function stubFor(name: string): DurableObjectStub<BoardDO> {
  return env.BOARD_DO.get(env.BOARD_DO.idFromName(name)) as unknown as DurableObjectStub<BoardDO>;
}

async function seed(board: BoardDO): Promise<string> {
  await board.init({ id: 'brd_r', tenantId: 'tnt_a', name: 'Refs', stages: PIPELINE });
  const c = await board.createCard({ title: 'Add OAuth login', ownerUserId: 'usr_a' });
  if (!c.ok) throw new Error(c.message);
  return c.value.id;
}

describe('BoardDO — references (docs/06)', () => {
  it('attaches a first-class reference that surfaces in the board snapshot', async () => {
    await runInDurableObject(stubFor('r-add'), async (board: BoardDO) => {
      const cardId = await seed(board);
      const r = await board.addReference({
        cardId,
        url: 'https://github.com/org/repo/pull/42',
        provider: 'github',
        sourceType: 'pull_request',
        title: 'Add OAuth login',
        externalId: 'PR_kwDOA',
        metadata: { draft: true },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.id).toMatch(/^ref_/);
      expect(r.value.addedBy).toBe('agent'); // default provenance for the agent contract
      expect(r.value.syncState).toBe('synced');

      const refs = (await board.getState()).references;
      expect(refs).toHaveLength(1);
      expect(refs[0]).toMatchObject({
        cardId,
        url: 'https://github.com/org/repo/pull/42',
        provider: 'github',
        sourceType: 'pull_request',
        externalId: 'PR_kwDOA',
        metadata: { draft: true },
      });
    });
  });

  it('is idempotent on (cardId, url): re-adding updates in place, never duplicates', async () => {
    await runInDurableObject(stubFor('r-idem'), async (board: BoardDO) => {
      const cardId = await seed(board);
      const first = await board.addReference({
        cardId,
        url: 'https://github.com/org/repo/pull/42',
        provider: 'github',
        sourceType: 'pull_request',
        subtitle: '#42 · draft',
        metadata: { draft: true, merged: false },
      });
      if (!first.ok) throw new Error('first add failed');

      const second = await board.addReference({
        cardId,
        url: 'https://github.com/org/repo/pull/42', // same dedup key
        provider: 'github',
        sourceType: 'pull_request',
        subtitle: '#42 · merged',
        metadata: { draft: false, merged: true },
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;

      // Same reference id (updated in place), updated fields, single row.
      expect(second.value.id).toBe(first.value.id);
      expect(second.value.subtitle).toBe('#42 · merged');
      expect(second.value.metadata).toEqual({ draft: false, merged: true });
      expect(second.value.createdAt).toBe(first.value.createdAt);

      const refs = (await board.getState()).references;
      expect(refs).toHaveLength(1);
      expect(refs[0]!.subtitle).toBe('#42 · merged');
    });
  });

  it('keeps distinct urls as distinct references', async () => {
    await runInDurableObject(stubFor('r-multi'), async (board: BoardDO) => {
      const cardId = await seed(board);
      await board.addReference({ cardId, url: 'https://github.com/org/repo/issues/7', provider: 'github', sourceType: 'issue' });
      await board.addReference({ cardId, url: 'https://docs.example.com/spec', provider: 'docs', sourceType: 'doc' });
      const refs = (await board.getState()).references;
      expect(refs).toHaveLength(2);
      expect(refs.map((r) => r.url).sort()).toEqual([
        'https://docs.example.com/spec',
        'https://github.com/org/repo/issues/7',
      ]);
    });
  });

  it('records the caller-supplied provenance (user vs agent)', async () => {
    await runInDurableObject(stubFor('r-prov'), async (board: BoardDO) => {
      const cardId = await seed(board);
      const r = await board.addReference({
        cardId,
        url: 'https://example.com/doc',
        provider: 'url',
        sourceType: 'url',
        addedBy: 'user',
      });
      expect(r.ok && r.value.addedBy).toBe('user');
    });
  });

  it('rejects a reference on an unknown card', async () => {
    await runInDurableObject(stubFor('r-nocard'), async (board: BoardDO) => {
      await seed(board);
      const r = await board.addReference({ cardId: 'card_nope', url: 'https://x.y', provider: 'url', sourceType: 'url' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('CARD_NOT_FOUND');
    });
  });

  it('rejects a reference before the board is initialized', async () => {
    await runInDurableObject(stubFor('r-noinit'), async (board: BoardDO) => {
      const r = await board.addReference({ cardId: 'card_x', url: 'https://x.y', provider: 'url', sourceType: 'url' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('NOT_INITIALIZED');
    });
  });
});
