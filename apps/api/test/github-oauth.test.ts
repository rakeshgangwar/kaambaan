import { describe, it, expect } from 'vitest';
import { githubAuthorizeUrl, exchangeCodeForToken, fetchGithubUser } from '../src/auth/github';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('GitHub OAuth client', () => {
  it('builds the authorize URL with client, redirect, scope, and state', () => {
    const url = githubAuthorizeUrl({ clientId: 'cli_1', redirectUri: 'https://app.test/auth/callback', state: 'st8', scope: 'read:user user:email' });
    expect(url.startsWith('https://github.com/login/oauth/authorize?')).toBe(true);
    const q = new URL(url).searchParams;
    expect(q.get('client_id')).toBe('cli_1');
    expect(q.get('redirect_uri')).toBe('https://app.test/auth/callback');
    expect(q.get('scope')).toBe('read:user user:email');
    expect(q.get('state')).toBe('st8');
  });

  it('exchanges a code for an access token', async () => {
    const fetchImpl = (async () => json({ access_token: 'ght_abc' })) as unknown as typeof fetch;
    const token = await exchangeCodeForToken({ code: 'c', clientId: 'cli', clientSecret: 'sec', redirectUri: 'https://app.test/auth/callback' }, fetchImpl);
    expect(token).toBe('ght_abc');
  });

  it('returns null when the token exchange fails', async () => {
    const fetchImpl = (async () => json({ error: 'bad_verification_code' })) as unknown as typeof fetch;
    expect(await exchangeCodeForToken({ code: 'c', clientId: 'cli', clientSecret: 'sec', redirectUri: 'r' }, fetchImpl)).toBeNull();
  });

  it('fetches the user profile + primary verified email', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/user')) return json({ id: 42, login: 'ada', name: 'Ada Lovelace', avatar_url: 'https://avatars/ada' });
      if (url.endsWith('/user/emails')) return json([{ email: 'ada@x.com', primary: true, verified: true }, { email: 'alt@x.com', primary: false, verified: true }]);
      return json({}, 404);
    }) as unknown as typeof fetch;

    const user = await fetchGithubUser('ght_abc', fetchImpl);
    expect(user).toEqual({ githubId: '42', login: 'ada', name: 'Ada Lovelace', avatarUrl: 'https://avatars/ada', email: 'ada@x.com' });
  });

  it('returns null when the profile fetch is unauthorized', async () => {
    const fetchImpl = (async () => json({ message: 'Bad credentials' }, 401)) as unknown as typeof fetch;
    expect(await fetchGithubUser('bad', fetchImpl)).toBeNull();
  });
});
