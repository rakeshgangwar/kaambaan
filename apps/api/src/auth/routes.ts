/**
 * Human auth routes (P0 "human login → session"). GitHub OAuth: /auth/login redirects to GitHub;
 * /auth/callback exchanges the code, upserts the user, bootstraps a personal workspace, and sets a
 * signed session cookie; /auth/me reports the current identity; /auth/logout clears it.
 */
import type { Env } from '../env';
import { githubAuthorizeUrl, exchangeCodeForToken, fetchGithubUser } from './github';
import { upsertUserByEmail, ensurePersonalWorkspace } from '../db/catalog';
import { signSession, sessionSetCookie, sessionClearCookie, SESSION_TTL_MS } from './session';
import { resolveUser } from './resolve';

const STATE_COOKIE = 'kaambaan_oauth_state';

function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get('Cookie');
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

/** Handle an /auth/* request, or return null if `path` isn't one. */
export async function handleAuthRoute(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path === '/auth/me') {
    const user = await resolveUser(request, env);
    return Response.json({ user: user ?? null });
  }

  if (path === '/auth/logout') {
    return new Response(null, { status: request.method === 'POST' ? 204 : 302, headers: { 'Set-Cookie': sessionClearCookie(), Location: env.APP_URL ?? '/' } });
  }

  if (path === '/auth/login') {
    if (!env.GITHUB_CLIENT_ID || !env.SESSION_SECRET) return new Response('Sign-in is not configured on this server.', { status: 503 });
    const origin = new URL(request.url).origin;
    const state = crypto.randomUUID();
    const location = githubAuthorizeUrl({ clientId: env.GITHUB_CLIENT_ID, redirectUri: `${origin}/auth/callback`, state });
    return new Response(null, {
      status: 302,
      headers: { Location: location, 'Set-Cookie': `${STATE_COOKIE}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600` },
    });
  }

  if (path === '/auth/callback') {
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.SESSION_SECRET) return new Response('Sign-in is not configured on this server.', { status: 503 });
    const u = new URL(request.url);
    const code = u.searchParams.get('code');
    const state = u.searchParams.get('state');
    if (!code || !state || state !== readCookie(request, STATE_COOKIE)) return new Response('Sign-in could not be verified. Please try again.', { status: 400 });

    const token = await exchangeCodeForToken({ code, clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET, redirectUri: `${u.origin}/auth/callback` });
    if (!token) return new Response('GitHub sign-in failed. Please try again.', { status: 401 });
    const ghUser = await fetchGithubUser(token);
    if (!ghUser || !ghUser.email) return new Response("We couldn't read a verified email from your GitHub account.", { status: 401 });

    const displayName = ghUser.name || ghUser.login;
    const user = await upsertUserByEmail(env.DB, { email: ghUser.email, name: displayName });
    const tenant = await ensurePersonalWorkspace(env.DB, user.id, displayName);
    const session = await signSession(
      { userId: user.id, tenantId: tenant.id, name: displayName, login: ghUser.login, avatarUrl: ghUser.avatarUrl ?? undefined, exp: Date.now() + SESSION_TTL_MS },
      env.SESSION_SECRET,
    );

    const headers = new Headers({ Location: env.APP_URL ?? '/' });
    headers.append('Set-Cookie', sessionSetCookie(session, { secure: true }));
    headers.append('Set-Cookie', `${STATE_COOKIE}=; Path=/; Max-Age=0`);
    return new Response(null, { status: 302, headers });
  }

  return null;
}
