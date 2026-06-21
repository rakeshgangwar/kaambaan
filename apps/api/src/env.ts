/** Worker bindings + config (docs/02-architecture.md). */
export interface Env {
  /** D1 catalog — tenants, users, memberships, boards index, agents, agent_tokens (P0). */
  DB: D1Database;
  /** One Board Durable Object instance per (tenant, board) — the live authority (P1). */
  BOARD_DO: DurableObjectNamespace;

  // ----- auth (real human login + agent tokens) -----
  /** HMAC key for signing session cookies (secret). */
  SESSION_SECRET?: string;
  /** GitHub OAuth app credentials (secret) for human sign-in. */
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  /** Public origin of the app (OAuth redirect + post-login redirect), e.g. https://kaambaan.example.com. */
  APP_URL?: string;
  /** When "true", accept dev-mode X-Tenant-Id / X-Agent-Id headers (local + tests). Never in prod. */
  DEV_AUTH?: string;
}
