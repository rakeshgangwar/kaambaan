/**
 * GitHub webhook signature (docs/06 §3, §6): verify `X-Hub-Signature-256` = HMAC-SHA256 of the raw
 * request body under the board's webhook secret, with a constant-time compare. Web Crypto only — no
 * Node `crypto`. `githubSignatureHeader` is the same primitive, exported for tests (and reused when
 * we sign outbound deliveries, docs/05 §4).
 */
const enc = new TextEncoder();

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function githubSignatureHeader(secret: string, body: string): Promise<string> {
  return `sha256=${await hmacHex(secret, body)}`;
}

export async function verifyGithubSignature(secret: string, rawBody: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  const match = header.match(/^sha256=([0-9a-f]{64})$/i);
  if (!match) return false;
  const expected = await hmacHex(secret, rawBody);
  return timingSafeEqual(match[1]!.toLowerCase(), expected);
}

/** Constant-time compare of two equal-length hex strings. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
