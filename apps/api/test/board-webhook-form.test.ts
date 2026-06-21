import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BoardDO, type BoardInit } from '../src/board/board-do';
import { githubSignatureHeader } from '../src/references/github-signature';

const PIPE: BoardInit['stages'] = [{ key: 'triage', name: 'Triage', order: 0, ownerKind: 'human' }];
const SECRET = 'form-secret';
const stubFor = (n: string) => env.BOARD_DO.get(env.BOARD_DO.idFromName(n)) as unknown as DurableObjectStub<BoardDO>;

const ISSUE = JSON.stringify({
  action: 'opened',
  issue: { number: 7, title: 'Bug: thing broke', state: 'open', html_url: 'https://github.com/org/repo/issues/7' },
  repository: { full_name: 'org/repo' },
});

describe('BoardDO — GitHub webhook accepts both content types', () => {
  it('opens a card from a form-encoded (application/x-www-form-urlencoded) issue payload — GitHub default', async () => {
    await runInDurableObject(stubFor('wh-form'), async (board: BoardDO) => {
      await board.init({ id: 'brd_f', tenantId: 'tnt_a', name: 'F', stages: PIPE });
      await board.setGithubConfig({ secret: SECRET, issueTrigger: true });

      // GitHub's default: the body is `payload=<url-encoded json>`, signed over THAT raw body.
      const formBody = `payload=${encodeURIComponent(ISSUE)}`;
      const r = await board.handleGithubWebhook({ rawBody: formBody, signature: await githubSignatureHeader(SECRET, formBody), deliveryId: 'f1', event: 'issues' });

      expect(r.ok).toBe(true);
      expect((await board.getState()).cards.find((c) => c.title === 'Bug: thing broke')).toBeTruthy();
    });
  });

  it('still opens a card from a raw JSON body', async () => {
    await runInDurableObject(stubFor('wh-json'), async (board: BoardDO) => {
      await board.init({ id: 'brd_j', tenantId: 'tnt_a', name: 'J', stages: PIPE });
      await board.setGithubConfig({ secret: SECRET, issueTrigger: true });
      const r = await board.handleGithubWebhook({ rawBody: ISSUE, signature: await githubSignatureHeader(SECRET, ISSUE), deliveryId: 'j1', event: 'issues' });
      expect(r.ok).toBe(true);
      expect((await board.getState()).cards.find((c) => c.title === 'Bug: thing broke')).toBeTruthy();
    });
  });
});
