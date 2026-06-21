import { describe, it, expect } from 'vitest';
import { signSession, verifySession, readSessionToken, sessionSetCookie, sessionClearCookie } from '../src/auth/session';

const SECRET = 'a-very-secret-signing-key';
const base = { userId: 'usr_1', tenantId: 'tnt_1', name: 'Ada', login: 'ada', avatarUrl: 'https://x/y.png' };

describe('session (signed, stateless)', () => {
  it('round-trips a signed session', async () => {
    const token = await signSession({ ...base, exp: Date.now() + 60_000 }, SECRET);
    const session = await verifySession(token, SECRET);
    expect(session).toMatchObject({ userId: 'usr_1', tenantId: 'tnt_1', login: 'ada' });
  });

  it('rejects a tampered payload', async () => {
    const token = await signSession({ ...base, exp: Date.now() + 60_000 }, SECRET);
    const [body, sig] = token.split('.');
    const forged = `${btoa('{"userId":"attacker","tenantId":"tnt_evil","exp":9999999999999}').replace(/=+$/, '')}.${sig}`;
    expect(await verifySession(forged, SECRET)).toBeNull();
    void body;
  });

  it('rejects a wrong signing secret', async () => {
    const token = await signSession({ ...base, exp: Date.now() + 60_000 }, SECRET);
    expect(await verifySession(token, 'different-secret')).toBeNull();
  });

  it('rejects an expired session', async () => {
    const token = await signSession({ ...base, exp: Date.now() - 1 }, SECRET);
    expect(await verifySession(token, SECRET)).toBeNull();
  });

  it('rejects malformed tokens', async () => {
    expect(await verifySession('', SECRET)).toBeNull();
    expect(await verifySession('only-one-part', SECRET)).toBeNull();
  });

  it('reads the session token from the Cookie header', () => {
    const req = new Request('https://x/', { headers: { Cookie: 'other=1; kaambaan_session=abc.def; foo=bar' } });
    expect(readSessionToken(req)).toBe('abc.def');
    expect(readSessionToken(new Request('https://x/'))).toBeNull();
  });

  it('builds httpOnly secure cookies', () => {
    const set = sessionSetCookie('abc.def', { secure: true });
    expect(set).toContain('kaambaan_session=abc.def');
    expect(set).toContain('HttpOnly');
    expect(set).toContain('Secure');
    expect(set).toContain('SameSite=Lax');
    expect(sessionClearCookie()).toContain('Max-Age=0');
  });
});
