import { tenantScopedSelect, type ScopedQuery } from './tenant-scope';

/**
 * Minimal subset of the D1 query API we depend on — declared structurally so the repository can be
 * unit-tested with a fake (and so the catalog isn't coupled to a specific runtime type).
 */
export interface D1Like {
  prepare(sql: string): D1StatementLike;
}
export interface D1StatementLike {
  bind(...params: unknown[]): D1BoundLike;
}
export interface D1BoundLike {
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

/**
 * Tenant-scoped catalog reads. Every method requires a tenantId and routes through
 * `tenantScopedSelect`, so there is no path to read another tenant's rows.
 */
export class CatalogRepository {
  constructor(private readonly db: D1Like) {}

  private run<T>(query: ScopedQuery): Promise<{ results: T[] }> {
    return this.db.prepare(query.sql).bind(...query.params).all<T>();
  }

  listBoards<T = Record<string, unknown>>(tenantId: string) {
    return this.run<T>(tenantScopedSelect('boards', tenantId));
  }

  getBoard<T = Record<string, unknown>>(tenantId: string, boardId: string) {
    return this.run<T>(tenantScopedSelect('boards', tenantId, { where: { id: boardId } }));
  }

  listAgents<T = Record<string, unknown>>(tenantId: string) {
    return this.run<T>(tenantScopedSelect('agents', tenantId));
  }
}
