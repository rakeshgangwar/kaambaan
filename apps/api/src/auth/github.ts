/**
 * GitHub OAuth client (the human-login flow, P0). Kaambaan is the OAuth *client*: redirect to
 * GitHub, exchange the code for a token, read the profile + primary verified email. Network calls
 * take an injectable `fetch` so the flow is unit-testable.
 */
type FetchLike = typeof fetch;

export interface GithubUser {
  githubId: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  email: string | null;
}

export function githubAuthorizeUrl(opts: { clientId: string; redirectUri: string; state: string; scope?: string }): string {
  const q = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope: opts.scope ?? 'read:user user:email',
    state: opts.state,
    allow_signup: 'true',
  });
  return `https://github.com/login/oauth/authorize?${q.toString()}`;
}

export async function exchangeCodeForToken(
  opts: { code: string; clientId: string; clientSecret: string; redirectUri: string },
  fetchImpl: FetchLike = fetch,
): Promise<string | null> {
  try {
    const res = await fetchImpl('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: opts.clientId, client_secret: opts.clientSecret, code: opts.code, redirect_uri: opts.redirectUri }),
    });
    const data = (await res.json()) as { access_token?: string };
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

export async function fetchGithubUser(accessToken: string, fetchImpl: FetchLike = fetch): Promise<GithubUser | null> {
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'kaambaan' };
  try {
    const profileRes = await fetchImpl('https://api.github.com/user', { headers });
    if (!profileRes.ok) return null;
    const p = (await profileRes.json()) as { id: number; login: string; name: string | null; avatar_url: string | null; email: string | null };

    let email = p.email;
    if (!email) {
      const emailRes = await fetchImpl('https://api.github.com/user/emails', { headers });
      if (emailRes.ok) {
        const emails = (await emailRes.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
        email = emails.find((e) => e.primary && e.verified)?.email ?? emails.find((e) => e.verified)?.email ?? null;
      }
    }
    return { githubId: String(p.id), login: p.login, name: p.name, avatarUrl: p.avatar_url, email };
  } catch {
    return null;
  }
}
