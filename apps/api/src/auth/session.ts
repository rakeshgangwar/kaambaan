/**
 * Stateless signed session (docs/02, P0 "human login → session"). The cookie value is
 * `base64url(payload) . hmac-sha256(payload)`; we verify the signature (constant-time) and the
 * expiry before trusting it, so no server-side session store is needed.
 */
import { hmacSha256Hex, timingSafeEqualHex } from '../crypto/hmac';

export interface SessionPayload {
  userId: string;
  tenantId: string;
  name?: string;
  login?: string;
  avatarUrl?: string;
  exp: number; // epoch ms
}

const COOKIE_NAME = 'kaambaan_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): string | null {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = await hmacSha256Hex(secret, body);
  return `${body}.${sig}`;
}

export async function verifySession(token: string, secret: string): Promise<SessionPayload | null> {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^[0-9a-f]{64}$/i.test(sig)) return null;
  const expected = await hmacSha256Hex(secret, body);
  if (!timingSafeEqualHex(sig.toLowerCase(), expected)) return null;
  const json = b64urlDecode(body);
  if (!json) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(json) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
  if (!payload.userId || !payload.tenantId) return null;
  return payload;
}

export function readSessionToken(request: Request): string | null {
  const cookie = request.headers.get('Cookie');
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return rest.join('=');
  }
  return null;
}

export function sessionSetCookie(token: string, opts: { secure: boolean }): string {
  const attrs = [`${COOKIE_NAME}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`];
  if (opts.secure) attrs.push('Secure');
  return attrs.join('; ');
}

export function sessionClearCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
