import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BoardDO, type BoardInit } from '../src/board/board-do';
import { githubSignatureHeader } from '../src/references/github-signature';

const PIPELINE: BoardInit['stages'] = [{ key: 'build', name: 'Build', order: 0, ownerKind: 'capability', owner: 'build' }];
const SECRET = 'hook-secret';

function stubFor(name: string): DurableObjectStub<BoardDO> {
  return env.BOARD_DO.get(env.BOARD_DO.idFromName(name)) as unknown as DurableObjectStub<BoardDO>;
}

async function setup(board: BoardDO): Promise<string> {
  await board.init({ id: 'brd_w', tenantId: 'tnt_a', name: 'W', stages: PIPELINE });
  await board.setGithubSecret(SECRET);
  const c = await board.createCard({ title: 'Add OAuth', ownerUserId: 'usr_a' });
  if (!c.ok) throw new Error('seed');
  await board.addReference({
    cardId: c.value.id,
    url: 'https://github.com/org/repo/pull/42',
    provider: 'github',
    sourceType: 'pull_request',
    externalId: 'org/repo#42',
  });
  return c.value.id;
}

function prPayload(action: string, over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    action,
    pull_request: { number: 42, draft: true, merged: false, state: 'open', base: { ref: 'main' }, head: { ref: 'feat' }, html_url: 'https://github.com/org/repo/pull/42', ...over },
    repository: { full_name: 'org/repo', default_branch: 'main' },
  });
}

const deliver = (board: BoardDO, body: string, sig: string | null, deliveryId: string) =>
  board.handleGithubWebhook({ rawBody: body, signature: sig, deliveryId, event: 'pull_request' });

describe('BoardDO — GitHub webhooks (docs/06 §2-3)', () => {
  it('applies a signed event to the matching reference sub-state', async () => {
    await runInDurableObject(stubFor('w-apply'), async (board: BoardDO) => {
      await setup(board);
      const body = prPayload('ready_for_review', { draft: false });
      const r = await deliver(board, body, await githubSignatureHeader(SECRET, body), 'd1');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.matched).toBe(1);
      const ref = (await board.getState()).references.find((x) => x.externalId === 'org/repo#42');
      expect(ref?.metadata).toMatchObject({ subState: 'awaiting_review', draft: false });
    });
  });

  it('rejects an invalid signature without mutating', async () => {
    await runInDurableObject(stubFor('w-badsig'), async (board: BoardDO) => {
      await setup(board);
      const body = prPayload('ready_for_review', { draft: false });
      const r = await deliver(board, body, `sha256=${'0'.repeat(64)}`, 'd1');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('INVALID_SIGNATURE');
      const ref = (await board.getState()).references.find((x) => x.externalId === 'org/repo#42');
      expect((ref?.metadata as Record<string, unknown> | null)?.subState).toBeUndefined();
    });
  });

  it('requires a configured secret', async () => {
    await runInDurableObject(stubFor('w-nosecret'), async (board: BoardDO) => {
      await board.init({ id: 'brd_n', tenantId: 'tnt_a', name: 'N', stages: PIPELINE });
      const body = prPayload('opened');
      const r = await deliver(board, body, `sha256=${'0'.repeat(64)}`, 'd');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('NOT_CONFIGURED');
    });
  });

  it('deduplicates repeated delivery ids (applies once)', async () => {
    await runInDurableObject(stubFor('w-dedup'), async (board: BoardDO) => {
      await setup(board);
      const body = prPayload('closed', { merged: true, state: 'closed' });
      const sig = await githubSignatureHeader(SECRET, body);
      const first = await deliver(board, body, sig, 'dup');
      const second = await deliver(board, body, sig, 'dup');
      expect(first.ok && first.value.deduped).toBe(false);
      expect(second.ok && second.value.deduped).toBe(true);
      const ref = (await board.getState()).references.find((x) => x.externalId === 'org/repo#42');
      expect(ref?.metadata).toMatchObject({ subState: 'merged', merged: true, mergedToDefaultBranch: true });
    });
  });

  it('ignores unmodeled events without error', async () => {
    await runInDurableObject(stubFor('w-ignore'), async (board: BoardDO) => {
      await setup(board);
      const body = prPayload('labeled');
      const r = await deliver(board, body, await githubSignatureHeader(SECRET, body), 'd');
      expect(r.ok && r.value.matched).toBe(0);
    });
  });

  it('is a no-op when no reference matches the event', async () => {
    await runInDurableObject(stubFor('w-nomatch'), async (board: BoardDO) => {
      await setup(board);
      const body = JSON.stringify({
        action: 'opened',
        pull_request: { number: 999, draft: true, state: 'open', base: { ref: 'main' }, head: { ref: 'x' }, html_url: 'u' },
        repository: { full_name: 'org/repo', default_branch: 'main' },
      });
      const r = await deliver(board, body, await githubSignatureHeader(SECRET, body), 'd');
      expect(r.ok && r.value.matched).toBe(0);
    });
  });
});
