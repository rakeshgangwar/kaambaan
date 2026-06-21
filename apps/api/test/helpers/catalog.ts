import { env } from 'cloudflare:test';

/** Create the catalog tables on the test D1 (mirrors migrations/0001_catalog.sql). */
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS memberships (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT, UNIQUE(tenant_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, stages_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, icon_url TEXT, capabilities_json TEXT NOT NULL DEFAULT '[]', connection_json TEXT NOT NULL DEFAULT '["rest"]', concurrency INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'offline', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS agent_tokens (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, agent_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, scopes_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now')), revoked_at TEXT)`,
];

export async function setupCatalog(): Promise<void> {
  for (const s of STATEMENTS) await env.DB.prepare(s).run();
}
