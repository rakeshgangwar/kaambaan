/** Worker bindings (docs/02-architecture.md). */
export interface Env {
  /** D1 catalog — tenants, users, memberships, boards index, agents (P0). */
  DB: D1Database;
  /** One Board Durable Object instance per (tenant, board) — the live authority (P1). */
  BOARD_DO: DurableObjectNamespace;
}
