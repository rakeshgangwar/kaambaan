import { describe, it, expect } from 'vitest';
import { signAndSend, type PushSender } from '../src/push/deliver';
import { verifyGithubSignature } from '../src/references/github-signature';

/** docs/05 §4: each outbound delivery is HMAC-signed; the receiver verifies, then may claim. */
describe('signAndSend', () => {
  it('signs the body with the config token and POSTs it (verifiable by the receiver)', async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const sender: PushSender = async (url, init) => {
      calls.push({ url, headers: init.headers, body: init.body });
      return { status: 200 };
    };
    const body = JSON.stringify({ event: 'work.available', boardId: 'brd_1', cardId: 'card_1' });
    const out = await signAndSend({ id: 1, url: 'https://agent.example/hook', body, token: 's3cret' }, sender);

    expect(out.ok).toBe(true);
    expect(out.status).toBe(200);
    expect(calls[0]!.url).toBe('https://agent.example/hook');
    const sig = calls[0]!.headers['X-Kaambaan-Signature']!;
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    // The same HMAC scheme the receiver verifies with.
    expect(await verifyGithubSignature('s3cret', body, sig)).toBe(true);
    expect(await verifyGithubSignature('wrong', body, sig)).toBe(false);
  });

  it('reports a non-2xx response as not ok', async () => {
    const out = await signAndSend({ id: 1, url: 'x', body: '{}', token: 't' }, async () => ({ status: 500 }));
    expect(out.ok).toBe(false);
    expect(out.status).toBe(500);
  });

  it('reports a thrown sender (network failure) as not ok', async () => {
    const out = await signAndSend({ id: 1, url: 'x', body: '{}', token: 't' }, async () => {
      throw new Error('network down');
    });
    expect(out.ok).toBe(false);
    expect(out.status).toBe(0);
  });
});
