-- Kaambaan catalog (D1) — the cross-board, identity/authz system of record (docs/02-architecture.md).
-- Every tenant-scoped table carries tenant_id; the data-access layer offers no unscoped read path.
-- Users are GLOBAL identities; membership ties them to tenants.

CREATE TABLE tenants (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT
);

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT
);

CREATE TABLE memberships (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  role        TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT,
  UNIQUE (tenant_id, user_id)
);
CREATE INDEX idx_memberships_tenant ON memberships(tenant_id);
CREATE INDEX idx_memberships_user ON memberships(user_id);

CREATE TABLE boards (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  name         TEXT NOT NULL,
  stages_json  TEXT NOT NULL, -- the pipeline definition (array of stages) as JSON
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT
);
CREATE INDEX idx_boards_tenant ON boards(tenant_id);

CREATE TABLE agents (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id),
  name              TEXT NOT NULL,
  icon_url          TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  connection_json   TEXT NOT NULL DEFAULT '["rest"]',
  concurrency       INTEGER NOT NULL DEFAULT 1,
  status            TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'busy', 'offline')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT
);
CREATE INDEX idx_agents_tenant ON agents(tenant_id);

CREATE TABLE agent_tokens (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  agent_id    TEXT NOT NULL REFERENCES agents(id),
  token_hash  TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at  TEXT
);
CREATE INDEX idx_agent_tokens_tenant ON agent_tokens(tenant_id);

CREATE TABLE webhooks (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  url         TEXT NOT NULL,
  secret      TEXT NOT NULL,
  events_json TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_webhooks_tenant ON webhooks(tenant_id);
