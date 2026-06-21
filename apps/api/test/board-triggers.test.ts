import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BoardDO, type BoardInit } from '../src/board/board-do';
import { githubSignatureHeader } from '../src/references/github-signature';

const PIPE: BoardInit['stages'] = [{ key: 'triage', name: 'Triage', order: 0 }];

function stubFor(name: string): DurableObjectStub<BoardDO> {
  return env.BOARD_DO.get(env.BOARD_DO.idFromName(name)) as unknown as DurableObjectStub<BoardDO>;
}

describe('BoardDO — inbound triggers (docs/05 §6)', () => {
  it('funnels a trigger into one card + a provenance reference', async () => {
    await runInDurableObject(stubFor('tr-funnel'), async (board: BoardDO) => {
      await board.init({ id: 'brd_tr', tenantId: 'tnt_a', name: 'TR', stages: PIPE });
      const r = await board.createCardFromTrigger({
        title: 'Investigate flaky CI',
        ownerUserId: 'usr_a',
        source: { url: 'https://github.com/org/repo/issues/7', provider: 'github', sourceType: 'issue', externalId: 'org/repo#7' },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.card.title).toBe('Investigate flaky CI');
      expect(r.value.reference?.externalId).toBe('org/repo#7');

      const snap = await board.getState();
      expect(snap.cards).toHaveLength(1);
      expect(snap.references).toHaveLength(1);
      expect(snap.references[0]!.cardId).toBe(r.value.card.id);
    });
  });

  it('creates a card from a GitHub issue when the issue trigger is enabled', async () => {
    await runInDurableObject(stubFor('tr-gh'), async (board: BoardDO) => {
      await board.init({ id: 'brd_gh', tenantId: 'tnt_a', name: 'GH', stages: PIPE });
      await board.setGithubConfig({ secret: 'hook', issueTrigger: true });
      const body = JSON.stringify({
        action: 'opened',
        issue: { number: 12, title: 'Login is broken', state: 'open', html_url: 'https://github.com/org/repo/issues/12' },
        repository: { full_name: 'org/repo' },
      });
      const r = await board.handleGithubWebhook({ rawBody: body, signature: await githubSignatureHeader('hook', body), deliveryId: 'd1', event: 'issues' });
      expect(r.ok).toBe(true);

      const snap = await board.getState();
      expect(snap.cards).toHaveLength(1);
      expect(snap.cards[0]!.title).toBe('Login is broken');
      expect(snap.references.find((ref) => ref.externalId === 'org/repo#12')).toBeDefined();
    });
  });

  it('does not create a card from an issue when the trigger is off', async () => {
    await runInDurableObject(stubFor('tr-off'), async (board: BoardDO) => {
      await board.init({ id: 'brd_off', tenantId: 'tnt_a', name: 'OFF', stages: PIPE });
      await board.setGithubConfig({ secret: 'hook' }); // issueTrigger defaults off
      const body = JSON.stringify({
        action: 'opened',
        issue: { number: 1, title: 'x', state: 'open', html_url: 'u' },
        repository: { full_name: 'org/repo' },
      });
      await board.handleGithubWebhook({ rawBody: body, signature: await githubSignatureHeader('hook', body), deliveryId: 'd1', event: 'issues' });
      expect((await board.getState()).cards).toHaveLength(0);
    });
  });
});
