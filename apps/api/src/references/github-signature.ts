/**
 * GitHub webhook signature (docs/06 §3, §6): verify `X-Hub-Signature-256` = HMAC-SHA256 of the raw
 * request body under the board's webhook secret, with a constant-time compare. The HMAC primitives
 * are shared with outbound push signing (`src/crypto/hmac.ts`).
 */
import { hmacSha256Hex, hmacSignatureHeader, timingSafeEqualHex } from '../crypto/hmac';

/** Re-exported for tests (and reused when we sign outbound deliveries). */
export const githubSignatureHeader = hmacSignatureHeader;

export async function verifyGithubSignature(secret: string, rawBody: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  const match = header.match(/^sha256=([0-9a-f]{64})$/i);
  if (!match) return false;
  const expected = await hmacSha256Hex(secret, rawBody);
  return timingSafeEqualHex(match[1]!.toLowerCase(), expected);
}
