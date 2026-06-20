import { describe, it, expect } from 'vitest';
import {
  tenantScopedSelect,
  assertTenantId,
  TenantIsolationError,
  TENANT_SCOPED_TABLES,
} from '../src/db/tenant-scope';

describe('assertTenantId', () => {
  it('throws on empty / whitespace / missing tenant', () => {
    expect(() => assertTenantId('')).toThrow(TenantIsolationError);
    expect(() => assertTenantId('   ')).toThrow(TenantIsolationError);
    expect(() => assertTenantId(undefined)).toThrow(TenantIsolationError);
    expect(() => assertTenantId(null)).toThrow(TenantIsolationError);
    expect(() => assertTenantId(123)).toThrow(TenantIsolationError);
  });
  it('passes for a non-empty tenant', () => {
    expect(() => assertTenantId('tnt_abc123')).not.toThrow();
  });
});

describe('tenantScopedSelect — structural isolation', () => {
  it('makes tenant_id the first predicate, bound first', () => {
    const q = tenantScopedSelect('boards', 'tnt_abc123');
    expect(q.sql).toBe('SELECT * FROM boards WHERE tenant_id = ?');
    expect(q.params[0]).toBe('tnt_abc123');
  });

  it('appends extra predicates after the tenant scope', () => {
    const q = tenantScopedSelect('boards', 'tnt_abc123', { where: { id: 'brd_1' } });
    expect(q.sql).toBe('SELECT * FROM boards WHERE tenant_id = ? AND id = ?');
    expect(q.params).toEqual(['tnt_abc123', 'brd_1']);
  });

  it('supports explicit columns', () => {
    const q = tenantScopedSelect('agents', 'tnt_abc123', { columns: ['id', 'name'] });
    expect(q.sql).toBe('SELECT id, name FROM agents WHERE tenant_id = ?');
  });

  it('refuses a query with no tenant', () => {
    expect(() => tenantScopedSelect('boards', '')).toThrow(TenantIsolationError);
  });

  it('refuses an unregistered (non-tenant-scoped) table', () => {
    expect(() => tenantScopedSelect('secrets', 'tnt_abc123')).toThrow(TenantIsolationError);
    // users are global, not tenant-scoped — must not be queryable through the tenant guard
    expect(() => tenantScopedSelect('users', 'tnt_abc123')).toThrow(TenantIsolationError);
  });

  it('every registered table is filtered by tenant_id', () => {
    for (const table of TENANT_SCOPED_TABLES) {
      const q = tenantScopedSelect(table, 'tnt_abc123');
      expect(q.sql).toContain('WHERE tenant_id = ?');
      expect(q.params[0]).toBe('tnt_abc123');
    }
  });
});
