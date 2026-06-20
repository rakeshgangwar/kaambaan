import { describe, it, expect } from 'vitest';
import { assertSameTenant, tenantOf, type Principal } from '../src/auth/principal';
import { TenantIsolationError } from '../src/db/tenant-scope';

const user: Principal = { kind: 'user', userId: 'usr_a', tenantId: 'tnt_a', role: 'member' };
const agent: Principal = { kind: 'agent', agentId: 'agt_a', tenantId: 'tnt_a', scopes: [] };

describe('assertSameTenant', () => {
  it('allows access within the same tenant (user and agent)', () => {
    expect(() => assertSameTenant(user, 'tnt_a')).not.toThrow();
    expect(() => assertSameTenant(agent, 'tnt_a')).not.toThrow();
  });

  it('blocks cross-tenant access', () => {
    expect(() => assertSameTenant(user, 'tnt_b')).toThrow(TenantIsolationError);
    expect(() => assertSameTenant(agent, 'tnt_b')).toThrow(TenantIsolationError);
  });

  it('blocks access when the resource tenant is empty', () => {
    expect(() => assertSameTenant(user, '')).toThrow(TenantIsolationError);
  });
});

describe('tenantOf', () => {
  it('returns the principal tenant', () => {
    expect(tenantOf(user)).toBe('tnt_a');
    expect(tenantOf(agent)).toBe('tnt_a');
  });
});
