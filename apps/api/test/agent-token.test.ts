import { describe, it, expect } from 'vitest';
import { generateAgentToken, hashToken } from '../src/auth/agent-token';

describe('agent tokens', () => {
  it('generates a prefixed, high-entropy, unique token', () => {
    const a = generateAgentToken();
    const b = generateAgentToken();
    expect(a.startsWith('kbn_')).toBe(true);
    expect(a.length).toBeGreaterThanOrEqual(36);
    expect(a).not.toBe(b);
  });

  it('hashes deterministically (stored hashed, looked up by hash)', async () => {
    const token = generateAgentToken();
    const h1 = await hashToken(token);
    const h2 = await hashToken(token);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashToken('different')).not.toBe(h1);
  });
});
