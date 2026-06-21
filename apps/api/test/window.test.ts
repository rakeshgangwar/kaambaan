import { describe, it, expect } from 'vitest';
import { parseWindowMs } from '../src/metering/window';

/** docs/07 §6: rolling windows (5h / weekly / monthly) for usage views. */
describe('parseWindowMs', () => {
  it('parses minutes, hours, and days', () => {
    expect(parseWindowMs('30m')).toBe(30 * 60_000);
    expect(parseWindowMs('5h')).toBe(5 * 3_600_000);
    expect(parseWindowMs('7d')).toBe(7 * 86_400_000);
    expect(parseWindowMs('30d')).toBe(30 * 86_400_000);
  });

  it('returns null for malformed or unsupported windows', () => {
    expect(parseWindowMs('')).toBeNull();
    expect(parseWindowMs('5')).toBeNull();
    expect(parseWindowMs('5y')).toBeNull();
    expect(parseWindowMs('abc')).toBeNull();
    expect(parseWindowMs('-5h')).toBeNull();
  });
});
