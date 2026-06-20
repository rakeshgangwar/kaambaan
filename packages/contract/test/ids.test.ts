import { describe, it, expect } from 'vitest';
import { TenantId, CardId, RunId, AgentId } from '../src';

describe('prefixed ids', () => {
  it('accepts well-formed ids', () => {
    expect(TenantId.safeParse('tnt_abc123').success).toBe(true);
    expect(CardId.safeParse('card_9f8e7d').success).toBe(true);
    expect(RunId.safeParse('run_Aa0Bb1').success).toBe(true);
    expect(AgentId.safeParse('agt_xyz789').success).toBe(true);
  });

  it('rejects the wrong prefix', () => {
    expect(CardId.safeParse('tnt_abc123').success).toBe(false);
    expect(RunId.safeParse('task_abc123').success).toBe(false);
  });

  it('rejects too-short tokens and bad characters', () => {
    expect(TenantId.safeParse('tnt_ab').success).toBe(false);
    expect(TenantId.safeParse('tnt_abc-12').success).toBe(false);
    expect(TenantId.safeParse('tnt_').success).toBe(false);
    expect(TenantId.safeParse('abc123').success).toBe(false);
  });
});
