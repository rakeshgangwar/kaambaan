import { describe, it, expect } from 'vitest';
import { CatalogRepository, type D1Like } from '../src/db/catalog';

/** A fake D1 that records executed (sql, params) so we can assert the tenant scope is applied. */
function fakeDb() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db: D1Like = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async all<T>() {
              calls.push({ sql, params });
              return { results: [] as T[] };
            },
          };
        },
      };
    },
  };
  return { db, calls };
}

describe('CatalogRepository enforces tenant scope', () => {
  it('scopes listBoards to the tenant', async () => {
    const { db, calls } = fakeDb();
    await new CatalogRepository(db).listBoards('tnt_a');
    expect(calls[0]!.sql).toContain('WHERE tenant_id = ?');
    expect(calls[0]!.params[0]).toBe('tnt_a');
  });

  it('binds both tenant and id for getBoard', async () => {
    const { db, calls } = fakeDb();
    await new CatalogRepository(db).getBoard('tnt_a', 'brd_1');
    expect(calls[0]!.params).toEqual(['tnt_a', 'brd_1']);
  });

  it('scopes listAgents to the tenant', async () => {
    const { db, calls } = fakeDb();
    await new CatalogRepository(db).listAgents('tnt_a');
    expect(calls[0]!.params[0]).toBe('tnt_a');
  });
});
