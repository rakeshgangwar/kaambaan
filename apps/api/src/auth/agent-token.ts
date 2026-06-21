/**
 * Per-agent bearer tokens (docs/05 §3, P0 `agent_tokens`). The plaintext token is shown once at
 * creation; only its SHA-256 hash is stored, and lookups are by hash — so a DB read never reveals a
 * usable credential.
 */
export function generateAgentToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `kbn_${hex}`;
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
