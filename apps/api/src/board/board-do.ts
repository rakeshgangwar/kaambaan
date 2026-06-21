import { DurableObject } from 'cloudflare:workers';
import type { TaskState } from '@kaambaan/contract';
import type { Env } from '../env';
import { newId } from '../ids';
import { verifyGithubSignature } from '../references/github-signature';
import { mapGithubEvent } from '../references/github-events';

/** JSON-serializable value — used for everything that crosses the Durable Object RPC boundary. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** How long an agent may go without a heartbeat before its run is reclaimed (docs/08 §3, ⚠️ OPEN). */
const HEARTBEAT_TIMEOUT_MS = 15 * 60 * 1000;
/** Consecutive failed/reclaimed runs before a card auto-blocks for a human (docs/08 §4, ⚠️ OPEN). */
const CIRCUIT_BREAKER_LIMIT = 2;

/** The decisions a human can take at an approval gate (docs/08 §6). */
const DEFAULT_GATE_OPTIONS: GateOption[] = [
  { name: 'approve', title: 'Approve' },
  { name: 'request_changes', title: 'Request changes', interactive: true },
  { name: 'reject', title: 'Reject' },
];

/** A pipeline stage (board column). `ownerKind`/`owner` drive agent claim routing (docs/01, docs/04). */
export interface StageDef {
  key: string;
  name: string;
  order: number;
  ownerKind?: 'capability' | 'agent' | 'human';
  owner?: string; // a capability tag (ownerKind=capability) or an agentId (ownerKind=agent)
  gate?: 'none' | 'approval';
  wipLimit?: number;
}

export interface BoardInit {
  id: string;
  tenantId: string;
  name: string;
  stages: StageDef[];
}

export interface CardView {
  id: string;
  title: string;
  spec: JsonValue;
  ownerUserId: string;
  currentStageKey: string;
  state: TaskState;
  delegateAgentId: string | null;
  priority: number;
  contextId: string;
  createdAt: string;
  updatedAt: string | null;
}

export interface BoardEvent {
  seq: number;
  type: string;
  payload: JsonValue;
  ts: string;
}

/** A choice presented to a human at an approval gate (HumanLayer-style options, docs/08 §6). */
export interface GateOption {
  name: string;
  title: string;
  promptFill?: string;
  interactive?: boolean;
}

export type GateDecision = 'approve' | 'request_changes' | 'reject';

export interface GateView {
  id: string;
  cardId: string;
  stageKey: string;
  status: 'pending' | 'resolved';
  decision: string | null;
  options: GateOption[];
  producedBy: string;
  createdAt: string;
}

/** A first-class external link on a card (docs/06). Idempotent on (cardId, url). */
export interface ReferenceView {
  id: string;
  cardId: string;
  url: string;
  title: string | null;
  subtitle: string | null;
  provider: string;
  sourceType: string;
  externalId: string | null;
  metadata: JsonValue | null;
  syncState: 'synced' | 'stale' | 'error';
  lastSyncedAt: string | null;
  addedBy: 'agent' | 'user';
  createdAt: string;
  updatedAt: string | null;
}

export interface ReferenceInput {
  cardId: string;
  url: string;
  provider: string;
  sourceType: string;
  title?: string;
  subtitle?: string;
  externalId?: string;
  metadata?: JsonValue;
  addedBy?: 'agent' | 'user';
  syncState?: 'synced' | 'stale' | 'error';
  lastSyncedAt?: string;
}

export interface BoardSnapshot {
  boardId: string | null;
  tenantId: string | null;
  name: string | null;
  stages: StageDef[];
  cards: CardView[];
  gates: GateView[];
  references: ReferenceView[];
}

/** The outcome of an agent claim — either work to do, or nothing available (docs/04 §3). */
export type ClaimResult =
  | {
      claimed: true;
      runId: string;
      leaseEpoch: number;
      card: CardView;
      stage: StageDef;
      handoff: JsonValue | null;
    }
  | { claimed: false };

/** Typed agent activity (docs/04 §4). `prompt` is human-authored and not posted by agents. */
export type AgentActivityType = 'thought' | 'action' | 'response' | 'elicitation' | 'error';

/**
 * Business outcomes are returned as values (not thrown). Throwing across the Durable Object RPC
 * boundary surfaces as an unhandled rejection in the runtime (docs/03, docs/08).
 */
export type BoardErrorCode =
  | 'NOT_INITIALIZED'
  | 'UNKNOWN_STAGE'
  | 'WIP_LIMIT'
  | 'CARD_NOT_FOUND'
  | 'STALE_LEASE'
  | 'GATE_NOT_FOUND'
  | 'GATE_NOT_PENDING'
  | 'SEPARATION_OF_DUTIES'
  | 'INVALID_URL'
  | 'INVALID_SIGNATURE'
  | 'NOT_CONFIGURED';

export type Result<T> = { ok: true; value: T } | { ok: false; code: BoardErrorCode; message: string };

/** The Board DO's RPC surface as the Worker calls it — hand-typed to avoid deep RPC type instantiation. */
export interface BoardStub {
  init(board: BoardInit): Promise<BoardSnapshot>;
  createCard(input: {
    title: string;
    ownerUserId: string;
    spec?: JsonValue;
    priority?: number;
  }): Promise<Result<CardView>>;
  moveCard(cardId: string, toStageKey: string, actorUserId?: string): Promise<Result<CardView>>;
  getState(): Promise<BoardSnapshot>;
  getEvents(limit?: number): Promise<BoardEvent[]>;
  // Agent contract (docs/04 §3)
  claim(input: { agentId: string; capabilities: string[]; maxConcurrency?: number }): Promise<ClaimResult>;
  heartbeat(input: { runId: string; leaseEpoch: number }): Promise<Result<{ acknowledged: true }>>;
  postActivity(input: AgentActivityInput): Promise<Result<{ accepted: true; cardState: TaskState }>>;
  complete(input: { runId: string; leaseEpoch: number; handoff?: JsonValue }): Promise<Result<CardView>>;
  block(input: { runId: string; leaseEpoch: number; reason: string }): Promise<Result<CardView>>;
  fail(input: { runId: string; leaseEpoch: number; reason: string }): Promise<Result<CardView>>;
  release(input: { runId: string; leaseEpoch: number; reason?: string }): Promise<Result<CardView>>;
  submitForReview(input: { runId: string; leaseEpoch: number; output?: JsonValue }): Promise<Result<CardView>>;
  addReference(input: ReferenceInput): Promise<Result<ReferenceView>>;
  setGithubSecret(secret: string): Promise<Result<{ configured: true }>>;
  handleGithubWebhook(input: {
    rawBody: string;
    signature: string | null;
    deliveryId: string | null;
    event: string;
  }): Promise<Result<{ deduped: boolean; matched: number }>>;
  resolveGate(input: {
    gateId: string;
    decision: GateDecision;
    decidedBy: string;
    comment?: string;
  }): Promise<Result<CardView>>;
  fetch(request: Request): Promise<Response>;
}

export interface AgentActivityInput {
  runId: string;
  leaseEpoch: number;
  type: AgentActivityType;
  ephemeral?: boolean;
  body?: string;
  action?: string;
  parameter?: JsonValue;
  result?: JsonValue;
  signal?: string;
}

type Row = Record<string, SqlStorageValue>;

/**
 * Board Durable Object — one instance per (tenant, board). The single-threaded DO is the live
 * authority for the board: card state in DO SQLite, an append-only event log, atomic mutations,
 * and a hibernatable WebSocket hub (docs/02, docs/07).
 *
 * P2 adds the agent execution loop (docs/04, docs/08): agents claim ready cards (capability-routed,
 * concurrency-limited), heartbeat, stream activities, and finish via complete/block/fail/release.
 * Each claim takes a lease with a fencing epoch; a missed heartbeat is reclaimed via a DO alarm,
 * and repeated failures trip a circuit breaker.
 */
export class BoardDO extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS cards (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        spec_json TEXT NOT NULL DEFAULT '{}',
        owner_user_id TEXT NOT NULL,
        current_stage_key TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'submitted',
        priority INTEGER NOT NULL DEFAULT 0,
        context_id TEXT NOT NULL,
        delegate_agent_id TEXT,
        current_run_id TEXT,
        claim_seq INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        handoff_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT
      )`,
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL,
        stage_key TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        lease_epoch INTEGER NOT NULL,
        status TEXT NOT NULL,
        outcome TEXT,
        last_heartbeat_ms INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT
      )`,
    );
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_runs_card ON runs(card_id)`);
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS activities (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        card_id TEXT NOT NULL,
        type TEXT NOT NULL,
        ephemeral INTEGER NOT NULL DEFAULT 0,
        body TEXT,
        action TEXT,
        detail_json TEXT,
        ts TEXT NOT NULL
      )`,
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        ts TEXT NOT NULL
      )`,
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS gates (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL,
        stage_key TEXT NOT NULL,
        return_stage_key TEXT NOT NULL,
        status TEXT NOT NULL,
        decision TEXT,
        comment TEXT,
        produced_by TEXT NOT NULL DEFAULT '',
        decided_by TEXT,
        options_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      )`,
    );
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_gates_card ON gates(card_id)`);
    // `references` is a SQL keyword, so the table is `card_references`. UNIQUE(card_id, url) is the
    // idempotent-upsert dedup key (docs/06 §1).
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS card_references (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL,
        url TEXT NOT NULL,
        title TEXT,
        subtitle TEXT,
        provider TEXT NOT NULL,
        source_type TEXT NOT NULL,
        external_id TEXT,
        metadata_json TEXT,
        sync_state TEXT NOT NULL DEFAULT 'synced',
        last_synced_at TEXT,
        added_by TEXT NOT NULL DEFAULT 'agent',
        created_at TEXT NOT NULL,
        updated_at TEXT,
        UNIQUE(card_id, url)
      )`,
    );
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_refs_card ON card_references(card_id)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_refs_external ON card_references(external_id)`);
    // Inbound webhook delivery dedup (docs/06 §3): GitHub may redeliver the same X-GitHub-Delivery.
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS webhook_deliveries (delivery_id TEXT PRIMARY KEY, received_at TEXT NOT NULL)`,
    );
  }

  // ----- RPC: board lifecycle -----

  async init(board: BoardInit): Promise<BoardSnapshot> {
    if (!this.getMeta('boardId')) {
      const stages = [...board.stages].sort((a, b) => a.order - b.order);
      this.setMeta('boardId', board.id);
      this.setMeta('tenantId', board.tenantId);
      this.setMeta('name', board.name);
      this.setMeta('stages', JSON.stringify(stages));
      this.emit('board.initialized', { boardId: board.id, tenantId: board.tenantId });
    }
    return this.snapshot();
  }

  async createCard(input: {
    title: string;
    ownerUserId: string;
    spec?: JsonValue;
    priority?: number;
  }): Promise<Result<CardView>> {
    if (!this.getMeta('boardId')) {
      return { ok: false, code: 'NOT_INITIALIZED', message: 'board is not initialized' };
    }
    const first = this.stages()[0];
    if (!first) return { ok: false, code: 'NOT_INITIALIZED', message: 'board has no stages' };
    const id = newId('card');
    const contextId = newId('ctx');
    const now = this.now();
    this.sql.exec(
      `INSERT INTO cards
        (id, title, spec_json, owner_user_id, current_stage_key, state, priority, context_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'submitted', ?, ?, ?, ?)`,
      id,
      input.title,
      JSON.stringify(input.spec ?? {}),
      input.ownerUserId,
      first.key,
      input.priority ?? 0,
      contextId,
      now,
      now,
    );
    const card = this.mustGetCard(id);
    this.emit('card.created', { card });
    return { ok: true, value: card };
  }

  /** Human move (docs/03). Enforces stage existence and the target stage's WIP limit. */
  async moveCard(cardId: string, toStageKey: string, actorUserId?: string): Promise<Result<CardView>> {
    if (!this.getMeta('boardId')) {
      return { ok: false, code: 'NOT_INITIALIZED', message: 'board is not initialized' };
    }
    const card = this.getCard(cardId);
    if (!card) return { ok: false, code: 'CARD_NOT_FOUND', message: `card not found: ${cardId}` };
    const target = this.stages().find((s) => s.key === toStageKey);
    if (!target) return { ok: false, code: 'UNKNOWN_STAGE', message: `unknown stage: ${toStageKey}` };
    if (target.key === card.currentStageKey) return { ok: true, value: card };
    if (target.wipLimit !== undefined && this.countInStage(target.key) >= target.wipLimit) {
      return {
        ok: false,
        code: 'WIP_LIMIT',
        message: `WIP limit reached for stage "${target.key}" (limit ${target.wipLimit})`,
      };
    }
    const now = this.now();
    this.sql.exec(`UPDATE cards SET current_stage_key = ?, updated_at = ? WHERE id = ?`, target.key, now, cardId);
    const updated = this.mustGetCard(cardId);
    this.emit('card.moved', {
      cardId,
      from: card.currentStageKey,
      to: target.key,
      by: actorUserId ?? null,
    });
    return { ok: true, value: updated };
  }

  async getState(): Promise<BoardSnapshot> {
    return this.snapshot();
  }

  async getEvents(limit = 100): Promise<BoardEvent[]> {
    return this.sql
      .exec(`SELECT seq, type, payload_json, ts FROM events ORDER BY seq DESC LIMIT ?`, limit)
      .toArray()
      .reverse()
      .map((r) => ({
        seq: Number(r.seq),
        type: r.type as string,
        payload: JSON.parse(r.payload_json as string),
        ts: r.ts as string,
      }));
  }

  /**
   * Idempotent upsert of a first-class reference, keyed on (cardId, url) (docs/06 §1).
   *
   * **Full-replace (PUT) semantics**: a re-add overwrites the mutable fields (title, subtitle,
   * provider, sourceType, externalId, metadata, syncState) with what's supplied — omitted optionals
   * become null. Callers (and the P5.2 sync worker) must send the complete current record. The
   * identity fields (id, created_at, added_by) are preserved across updates.
   *
   * Only `http(s)` urls are accepted: a reference url renders as an outbound link in the board UI,
   * so rejecting other schemes (`javascript:`, `data:`, …) at the write boundary forecloses stored
   * XSS and is the first slice of the §6 SSRF allowlist.
   */
  async addReference(input: ReferenceInput): Promise<Result<ReferenceView>> {
    if (!this.getMeta('boardId')) {
      return { ok: false, code: 'NOT_INITIALIZED', message: 'board is not initialized' };
    }
    let scheme = '';
    try {
      scheme = new URL(input.url).protocol;
    } catch {
      scheme = '';
    }
    if (scheme !== 'http:' && scheme !== 'https:') {
      return { ok: false, code: 'INVALID_URL', message: `unsupported reference url scheme: ${input.url}` };
    }
    if (!this.getCardRow(input.cardId)) {
      return { ok: false, code: 'CARD_NOT_FOUND', message: `card not found: ${input.cardId}` };
    }
    const now = this.now();
    const metadataJson = input.metadata === undefined ? null : JSON.stringify(input.metadata);
    const existing = this.sql
      .exec(`SELECT id FROM card_references WHERE card_id = ? AND url = ?`, input.cardId, input.url)
      .toArray()[0];

    if (existing) {
      const id = existing.id as string;
      this.sql.exec(
        `UPDATE card_references
           SET title = ?, subtitle = ?, provider = ?, source_type = ?, external_id = ?,
               metadata_json = ?, sync_state = ?, last_synced_at = ?, updated_at = ?
         WHERE id = ?`,
        input.title ?? null,
        input.subtitle ?? null,
        input.provider,
        input.sourceType,
        input.externalId ?? null,
        metadataJson,
        input.syncState ?? 'synced',
        input.lastSyncedAt ?? null,
        now,
        id,
      );
      const ref = this.mustGetReference(id);
      this.emit('reference.updated', { reference: ref });
      return { ok: true, value: ref };
    }

    const id = newId('ref');
    this.sql.exec(
      `INSERT INTO card_references
        (id, card_id, url, title, subtitle, provider, source_type, external_id, metadata_json, sync_state, last_synced_at, added_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.cardId,
      input.url,
      input.title ?? null,
      input.subtitle ?? null,
      input.provider,
      input.sourceType,
      input.externalId ?? null,
      metadataJson,
      input.syncState ?? 'synced',
      input.lastSyncedAt ?? null,
      input.addedBy ?? 'agent',
      now,
    );
    const ref = this.mustGetReference(id);
    this.emit('reference.added', { reference: ref });
    return { ok: true, value: ref };
  }

  /** Store/rotate this board's GitHub webhook secret (docs/06 §3, §6). */
  async setGithubSecret(secret: string): Promise<Result<{ configured: true }>> {
    if (!this.getMeta('boardId')) {
      return { ok: false, code: 'NOT_INITIALIZED', message: 'board is not initialized' };
    }
    this.setMeta('githubWebhookSecret', secret);
    return { ok: true, value: { configured: true } };
  }

  /**
   * Ingest a GitHub webhook (docs/06 §3): verify the HMAC signature over the raw body, dedup on the
   * delivery id, then apply the draft-PR sub-state machine to every reference matching the event's
   * externalId. Verification + dedup + mutation are co-located here because the DO owns both the
   * board's secret and the references.
   */
  async handleGithubWebhook(input: {
    rawBody: string;
    signature: string | null;
    deliveryId: string | null;
    event: string;
  }): Promise<Result<{ deduped: boolean; matched: number }>> {
    if (!this.getMeta('boardId')) {
      return { ok: false, code: 'NOT_INITIALIZED', message: 'board is not initialized' };
    }
    const secret = this.getMeta('githubWebhookSecret');
    if (!secret) {
      return { ok: false, code: 'NOT_CONFIGURED', message: 'no github webhook secret configured for this board' };
    }
    if (!(await verifyGithubSignature(secret, input.rawBody, input.signature))) {
      return { ok: false, code: 'INVALID_SIGNATURE', message: 'invalid X-Hub-Signature-256' };
    }

    if (input.deliveryId) {
      const seen = this.sql.exec(`SELECT 1 FROM webhook_deliveries WHERE delivery_id = ?`, input.deliveryId).toArray()[0];
      if (seen) return { ok: true, value: { deduped: true, matched: 0 } };
      this.sql.exec(`INSERT INTO webhook_deliveries (delivery_id, received_at) VALUES (?, ?)`, input.deliveryId, this.now());
    }

    let payload: unknown;
    try {
      payload = JSON.parse(input.rawBody);
    } catch {
      return { ok: true, value: { deduped: false, matched: 0 } };
    }
    const mapped = mapGithubEvent(input.event, payload);
    if (!mapped) return { ok: true, value: { deduped: false, matched: 0 } };

    const now = this.now();
    const rows = this.sql.exec(`SELECT * FROM card_references WHERE external_id = ?`, mapped.externalId).toArray();
    for (const row of rows) {
      const current = (row.metadata_json ? JSON.parse(row.metadata_json as string) : {}) as Record<string, unknown>;
      const merged = { ...current, ...mapped.metadata, subState: mapped.subState };
      this.sql.exec(
        `UPDATE card_references SET metadata_json = ?, sync_state = 'synced', last_synced_at = ?, updated_at = ? WHERE id = ?`,
        JSON.stringify(merged),
        now,
        now,
        row.id as string,
      );
      this.emit('reference.updated', { reference: this.mustGetReference(row.id as string) });
    }
    return { ok: true, value: { deduped: false, matched: rows.length } };
  }

  // ----- RPC: agent contract (docs/04) -----

  /** Atomically hand a ready, capability-matched card to an agent, within its concurrency limit. */
  async claim(input: {
    agentId: string;
    capabilities: string[];
    maxConcurrency?: number;
  }): Promise<ClaimResult> {
    if (!this.getMeta('boardId')) return { claimed: false };
    const max = input.maxConcurrency ?? 1;
    const active = Number(
      this.sql.exec(`SELECT COUNT(*) AS n FROM runs WHERE agent_id = ? AND status = 'working'`, input.agentId).one().n,
    );
    if (active >= max) return { claimed: false };

    const claimableKeys = this.stages()
      .filter((s) => this.stageMatches(s, input.agentId, input.capabilities))
      .map((s) => s.key);
    if (claimableKeys.length === 0) return { claimed: false };

    const placeholders = claimableKeys.map(() => '?').join(', ');
    const row = this.sql
      .exec(
        `SELECT * FROM cards WHERE state = 'submitted' AND current_stage_key IN (${placeholders})
         ORDER BY priority DESC, created_at ASC LIMIT 1`,
        ...claimableKeys,
      )
      .toArray()[0];
    if (!row) return { claimed: false };

    const card = this.rowToCard(row);
    const leaseEpoch = Number(row.claim_seq) + 1;
    const runId = newId('run');
    const now = this.now();
    const nowMs = this.nowMs();
    this.sql.exec(
      `INSERT INTO runs (id, card_id, stage_key, agent_id, lease_epoch, status, outcome, last_heartbeat_ms, started_at, ended_at)
       VALUES (?, ?, ?, ?, ?, 'working', NULL, ?, ?, NULL)`,
      runId,
      card.id,
      card.currentStageKey,
      input.agentId,
      leaseEpoch,
      nowMs,
      now,
    );
    this.sql.exec(
      `UPDATE cards SET state = 'working', delegate_agent_id = ?, current_run_id = ?, claim_seq = ?, updated_at = ? WHERE id = ?`,
      input.agentId,
      runId,
      leaseEpoch,
      now,
      card.id,
    );
    this.emit('card.claimed', { cardId: card.id, agentId: input.agentId, runId });
    await this.scheduleReclaim();

    const stage = this.stages().find((s) => s.key === card.currentStageKey)!;
    const handoff = row.handoff_json ? (JSON.parse(row.handoff_json as string) as JsonValue) : null;
    return { claimed: true, runId, leaseEpoch, card: this.mustGetCard(card.id), stage, handoff };
  }

  async heartbeat(input: { runId: string; leaseEpoch: number }): Promise<Result<{ acknowledged: true }>> {
    const run = this.getActiveRunRow(input.runId, input.leaseEpoch);
    if (!run) return this.staleLease();
    this.sql.exec(`UPDATE runs SET last_heartbeat_ms = ? WHERE id = ?`, this.nowMs(), input.runId);
    await this.scheduleReclaim();
    return { ok: true, value: { acknowledged: true } };
  }

  async postActivity(input: AgentActivityInput): Promise<Result<{ accepted: true; cardState: TaskState }>> {
    const run = this.getActiveRunRow(input.runId, input.leaseEpoch);
    if (!run) return this.staleLease();
    const cardId = run.card_id as string;
    const now = this.now();
    const detail = JSON.stringify({
      parameter: input.parameter ?? null,
      result: input.result ?? null,
      signal: input.signal ?? null,
    });
    this.sql.exec(
      `INSERT INTO activities (run_id, card_id, type, ephemeral, body, action, detail_json, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      input.runId,
      cardId,
      input.type,
      input.ephemeral ? 1 : 0,
      input.body ?? null,
      input.action ?? null,
      detail,
      now,
    );
    // An activity is also a sign of life — it keeps the lease fresh.
    this.sql.exec(`UPDATE runs SET last_heartbeat_ms = ? WHERE id = ?`, this.nowMs(), input.runId);
    let cardState: TaskState = 'working';
    if (input.type === 'elicitation') {
      cardState = input.signal === 'auth' ? 'auth-required' : 'input-required';
      this.sql.exec(`UPDATE cards SET state = ?, updated_at = ? WHERE id = ?`, cardState, now, cardId);
    }
    this.emit('activity', { runId: input.runId, cardId, activityType: input.type });
    await this.scheduleReclaim();
    return { ok: true, value: { accepted: true, cardState } };
  }

  /** Finish a stage successfully, store the handoff, and advance the card (or mark it done). */
  async complete(input: { runId: string; leaseEpoch: number; handoff?: JsonValue }): Promise<Result<CardView>> {
    const run = this.getActiveRunRow(input.runId, input.leaseEpoch);
    if (!run) return this.staleLease();
    const cardId = run.card_id as string;
    const now = this.now();
    this.sql.exec(`UPDATE runs SET status = 'ended', outcome = 'completed', ended_at = ? WHERE id = ?`, now, input.runId);

    const card = this.mustGetCard(cardId);
    const handoffJson = input.handoff !== undefined ? JSON.stringify(input.handoff) : null;
    this.advanceCard(cardId, card.currentStageKey, run.agent_id as string, handoffJson);
    await this.scheduleReclaim();
    return { ok: true, value: this.mustGetCard(cardId) };
  }

  /** Submit a gated, agent-worked stage for human approval (docs/04, docs/08 §6). */
  async submitForReview(input: { runId: string; leaseEpoch: number; output?: JsonValue }): Promise<Result<CardView>> {
    const run = this.getActiveRunRow(input.runId, input.leaseEpoch);
    if (!run) return this.staleLease();
    const cardId = run.card_id as string;
    const now = this.now();
    this.sql.exec(`UPDATE runs SET status = 'ended', outcome = 'submitted', ended_at = ? WHERE id = ?`, now, input.runId);
    const card = this.mustGetCard(cardId);
    this.sql.exec(
      `UPDATE cards SET state = 'input-required', delegate_agent_id = NULL, current_run_id = NULL, updated_at = ? WHERE id = ?`,
      now,
      cardId,
    );
    // request_changes returns to the same (worked) stage so the agent can redo it.
    this.createGate(cardId, card.currentStageKey, card.currentStageKey, run.agent_id as string);
    await this.scheduleReclaim();
    return { ok: true, value: this.mustGetCard(cardId) };
  }

  /** Resolve a pending approval gate (docs/08 §6). Enforces separation of duties. */
  async resolveGate(input: {
    gateId: string;
    decision: GateDecision;
    decidedBy: string;
    comment?: string;
  }): Promise<Result<CardView>> {
    const gate = this.sql.exec(`SELECT * FROM gates WHERE id = ?`, input.gateId).toArray()[0];
    if (!gate) return { ok: false, code: 'GATE_NOT_FOUND', message: `gate not found: ${input.gateId}` };
    if ((gate.status as string) !== 'pending') {
      return { ok: false, code: 'GATE_NOT_PENDING', message: 'gate is already resolved' };
    }
    if (input.decidedBy === (gate.produced_by as string)) {
      return { ok: false, code: 'SEPARATION_OF_DUTIES', message: 'the producer cannot resolve their own gate' };
    }
    const cardId = gate.card_id as string;
    const now = this.now();
    this.sql.exec(
      `UPDATE gates SET status = 'resolved', decision = ?, comment = ?, decided_by = ?, resolved_at = ? WHERE id = ?`,
      input.decision,
      input.comment ?? null,
      input.decidedBy,
      now,
      input.gateId,
    );
    if (input.decision === 'approve') {
      // The approver becomes the producer of any chained gate (keeps separation-of-duties intact).
      this.advanceCard(cardId, gate.stage_key as string, input.decidedBy, this.getCardHandoffJson(cardId));
    } else if (input.decision === 'request_changes') {
      // Keep the agent's prior handoff and add the reviewer's feedback so rework has full context.
      const prior = this.parseHandoff(this.getCardHandoffJson(cardId));
      const merged =
        prior && typeof prior === 'object' && !Array.isArray(prior)
          ? { ...prior, feedback: input.comment ?? null }
          : { feedback: input.comment ?? null };
      this.sql.exec(
        `UPDATE cards SET current_stage_key = ?, state = 'submitted', delegate_agent_id = NULL,
         current_run_id = NULL, failure_count = 0, handoff_json = ?, updated_at = ? WHERE id = ?`,
        gate.return_stage_key,
        JSON.stringify(merged),
        now,
        cardId,
      );
      this.emit('card.changes_requested', { cardId, gateId: input.gateId, to: gate.return_stage_key });
    } else {
      this.sql.exec(
        `UPDATE cards SET state = 'rejected', delegate_agent_id = NULL, current_run_id = NULL, updated_at = ? WHERE id = ?`,
        now,
        cardId,
      );
      this.emit('card.rejected', { cardId, gateId: input.gateId });
    }
    this.emit('gate.resolved', { gateId: input.gateId, cardId, decision: input.decision, decidedBy: input.decidedBy });
    return { ok: true, value: this.mustGetCard(cardId) };
  }

  /** Escalate to a human — the card parks in input-required (docs/08 §6 — gates resolve in P3). */
  async block(input: { runId: string; leaseEpoch: number; reason: string }): Promise<Result<CardView>> {
    const run = this.getActiveRunRow(input.runId, input.leaseEpoch);
    if (!run) return this.staleLease();
    const cardId = run.card_id as string;
    const now = this.now();
    this.sql.exec(`UPDATE runs SET status = 'ended', outcome = 'blocked', ended_at = ? WHERE id = ?`, now, input.runId);
    this.sql.exec(
      `UPDATE cards SET state = 'input-required', delegate_agent_id = NULL, current_run_id = NULL, updated_at = ? WHERE id = ?`,
      now,
      cardId,
    );
    this.emit('card.blocked', { cardId, reason: input.reason });
    await this.scheduleReclaim();
    return { ok: true, value: this.mustGetCard(cardId) };
  }

  /** Report a failure — retryable until the circuit breaker trips (docs/08 §4). */
  async fail(input: { runId: string; leaseEpoch: number; reason: string }): Promise<Result<CardView>> {
    const run = this.getActiveRunRow(input.runId, input.leaseEpoch);
    if (!run) return this.staleLease();
    const cardId = run.card_id as string;
    this.sql.exec(`UPDATE runs SET status = 'ended', outcome = 'crashed', ended_at = ? WHERE id = ?`, this.now(), input.runId);
    this.endAttempt(cardId, 'card.failed', input.reason);
    return { ok: true, value: this.mustGetCard(cardId) };
  }

  /** Give the claim back without penalty — the card becomes claimable again (docs/04). */
  async release(input: { runId: string; leaseEpoch: number; reason?: string }): Promise<Result<CardView>> {
    const run = this.getActiveRunRow(input.runId, input.leaseEpoch);
    if (!run) return this.staleLease();
    const cardId = run.card_id as string;
    const now = this.now();
    this.sql.exec(`UPDATE runs SET status = 'ended', outcome = 'released', ended_at = ? WHERE id = ?`, now, input.runId);
    this.sql.exec(
      `UPDATE cards SET state = 'submitted', delegate_agent_id = NULL, current_run_id = NULL, updated_at = ? WHERE id = ?`,
      now,
      cardId,
    );
    this.emit('run.released', { cardId, runId: input.runId });
    await this.scheduleReclaim();
    return { ok: true, value: this.mustGetCard(cardId) };
  }

  /**
   * Reclaim runs whose heartbeat lapsed by `nowMs` (Temporal-style heartbeat timeout, docs/08 §3).
   * Time is a parameter so the alarm passes `Date.now()` while tests pass a chosen instant.
   */
  reclaimExpired(nowMs: number): number {
    const rows = this.sql
      .exec(
        `SELECT id, card_id FROM runs WHERE status = 'working' AND (last_heartbeat_ms + ?) <= ?`,
        HEARTBEAT_TIMEOUT_MS,
        nowMs,
      )
      .toArray();
    const now = this.now();
    for (const r of rows) {
      this.sql.exec(`UPDATE runs SET status = 'ended', outcome = 'reclaimed', ended_at = ? WHERE id = ?`, now, r.id);
      this.endAttempt(r.card_id as string, 'run.reclaimed', null, String(r.id));
    }
    return rows.length;
  }

  // ----- WebSocket hub (hibernatable) -----

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected a websocket upgrade', { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ kind: 'snapshot', state: this.snapshot() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): void {
    // The board is read-only over WebSocket; mutations go through the REST/RPC verbs.
  }

  webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean): void {
    try {
      ws.close(code);
    } catch {
      // already closed
    }
  }

  /** DO alarm: reclaim lapsed runs, then re-arm for the next-earliest heartbeat deadline. */
  async alarm(): Promise<void> {
    this.reclaimExpired(this.nowMs());
    await this.scheduleReclaim();
  }

  // ----- internals -----

  /** End the current attempt on a card: bump failures and either re-queue or trip the breaker. */
  private endAttempt(cardId: string, event: string, reason: string | null, runId?: string): void {
    const cardRow = this.getCardRow(cardId);
    if (!cardRow) return;
    const failures = Number(cardRow.failure_count) + 1;
    const state: TaskState = failures >= CIRCUIT_BREAKER_LIMIT ? 'input-required' : 'submitted';
    const now = this.now();
    this.sql.exec(
      `UPDATE cards SET state = ?, delegate_agent_id = NULL, current_run_id = NULL, failure_count = ?, updated_at = ? WHERE id = ?`,
      state,
      failures,
      now,
      cardId,
    );
    this.emit(event, { cardId, runId: runId ?? null, reason, failures, brokeCircuit: state === 'input-required' });
  }

  /** Advance a card to the next stage — opening an approval gate on entry to a human review stage. */
  private advanceCard(cardId: string, fromStageKey: string, producedBy: string, handoffJson: string | null): void {
    const stages = this.stages();
    const idx = stages.findIndex((s) => s.key === fromStageKey);
    if (idx === -1) return; // unknown stage — never silently advance to stage[0]
    const next = stages[idx + 1];
    const now = this.now();
    if (!next) {
      this.sql.exec(
        `UPDATE cards SET state = 'completed', delegate_agent_id = NULL, current_run_id = NULL, failure_count = 0, handoff_json = ?, updated_at = ? WHERE id = ?`,
        handoffJson,
        now,
        cardId,
      );
      this.emit('card.completed', { cardId });
      return;
    }
    const gated = next.gate === 'approval' && !this.isAgentClaimable(next);
    this.sql.exec(
      `UPDATE cards SET current_stage_key = ?, state = ?, delegate_agent_id = NULL, current_run_id = NULL, failure_count = 0, handoff_json = ?, updated_at = ? WHERE id = ?`,
      next.key,
      gated ? 'input-required' : 'submitted',
      handoffJson,
      now,
      cardId,
    );
    this.emit('card.advanced', { cardId, from: fromStageKey, to: next.key });
    if (gated) this.createGate(cardId, next.key, fromStageKey, producedBy);
  }

  private createGate(cardId: string, stageKey: string, returnStageKey: string, producedBy: string): string {
    const id = newId('gate');
    const now = this.now();
    this.sql.exec(
      `INSERT INTO gates (id, card_id, stage_key, return_stage_key, status, produced_by, options_json, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
      id,
      cardId,
      stageKey,
      returnStageKey,
      producedBy,
      JSON.stringify(DEFAULT_GATE_OPTIONS),
      now,
    );
    this.emit('gate.opened', { gateId: id, cardId, stageKey });
    return id;
  }

  private isAgentClaimable(stage: StageDef): boolean {
    return stage.ownerKind === 'capability' || stage.ownerKind === 'agent';
  }

  private getCardHandoffJson(cardId: string): string | null {
    const row = this.getCardRow(cardId);
    return row ? ((row.handoff_json as string | null) ?? null) : null;
  }

  private parseHandoff(raw: string | null): JsonValue | null {
    return raw ? (JSON.parse(raw) as JsonValue) : null;
  }

  private pendingGates(): GateView[] {
    return this.sql
      .exec(`SELECT * FROM gates WHERE status = 'pending' ORDER BY created_at ASC`)
      .toArray()
      .map((r) => ({
        id: r.id as string,
        cardId: r.card_id as string,
        stageKey: r.stage_key as string,
        status: r.status as 'pending' | 'resolved',
        decision: (r.decision as string | null) ?? null,
        options: JSON.parse(r.options_json as string) as GateOption[],
        producedBy: r.produced_by as string,
        createdAt: r.created_at as string,
      }));
  }

  private stageMatches(stage: StageDef, agentId: string, capabilities: string[]): boolean {
    if (stage.ownerKind === 'agent') return stage.owner === agentId;
    if (stage.ownerKind === 'capability') return stage.owner !== undefined && capabilities.includes(stage.owner);
    return false;
  }

  private getActiveRunRow(runId: string, leaseEpoch: number): Row | null {
    const row = this.sql.exec(`SELECT * FROM runs WHERE id = ?`, runId).toArray()[0];
    if (!row) return null;
    if ((row.status as string) !== 'working') return null;
    if (Number(row.lease_epoch) !== leaseEpoch) return null;
    return row;
  }

  private staleLease<T>(): Result<T> {
    return { ok: false, code: 'STALE_LEASE', message: 'no active lease for this run' };
  }

  private async scheduleReclaim(): Promise<void> {
    const min = this.sql.exec(`SELECT MIN(last_heartbeat_ms) AS m FROM runs WHERE status = 'working'`).one().m;
    if (min === null || min === undefined) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Number(min) + HEARTBEAT_TIMEOUT_MS);
  }

  private emit(type: string, payload: Record<string, unknown>): void {
    const ts = this.now();
    this.sql.exec(`INSERT INTO events (type, payload_json, ts) VALUES (?, ?, ?)`, type, JSON.stringify(payload), ts);
    const seq = Number(this.sql.exec(`SELECT last_insert_rowid() AS seq`).one().seq);
    const msg = JSON.stringify({ kind: 'event', event: { seq, type, payload, ts } });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(msg);
      } catch {
        // drop broken sockets silently
      }
    }
  }

  private getMeta(k: string): string | null {
    const row = this.sql.exec(`SELECT v FROM meta WHERE k = ?`, k).toArray()[0];
    return row ? (row.v as string) : null;
  }

  private setMeta(k: string, v: string): void {
    this.sql.exec(`INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`, k, v);
  }

  private stages(): StageDef[] {
    const raw = this.getMeta('stages');
    return raw ? (JSON.parse(raw) as StageDef[]) : [];
  }

  private countInStage(stageKey: string): number {
    return Number(this.sql.exec(`SELECT COUNT(*) AS n FROM cards WHERE current_stage_key = ?`, stageKey).one().n);
  }

  private getCardRow(id: string): Row | null {
    return this.sql.exec(`SELECT * FROM cards WHERE id = ?`, id).toArray()[0] ?? null;
  }

  private getCard(id: string): CardView | null {
    const row = this.getCardRow(id);
    return row ? this.rowToCard(row) : null;
  }

  private mustGetCard(id: string): CardView {
    const card = this.getCard(id);
    if (!card) throw new Error(`invariant violation: card ${id} missing immediately after write`);
    return card;
  }

  private allCards(): CardView[] {
    return this.sql
      .exec(`SELECT * FROM cards ORDER BY priority DESC, created_at ASC`)
      .toArray()
      .map((r) => this.rowToCard(r));
  }

  private rowToCard(row: Row): CardView {
    return {
      id: row.id as string,
      title: row.title as string,
      spec: JSON.parse(row.spec_json as string),
      ownerUserId: row.owner_user_id as string,
      currentStageKey: row.current_stage_key as string,
      state: row.state as TaskState,
      delegateAgentId: (row.delegate_agent_id as string | null) ?? null,
      priority: Number(row.priority),
      contextId: row.context_id as string,
      createdAt: row.created_at as string,
      updatedAt: (row.updated_at as string | null) ?? null,
    };
  }

  private rowToReference(row: Row): ReferenceView {
    return {
      id: row.id as string,
      cardId: row.card_id as string,
      url: row.url as string,
      title: (row.title as string | null) ?? null,
      subtitle: (row.subtitle as string | null) ?? null,
      provider: row.provider as string,
      sourceType: row.source_type as string,
      externalId: (row.external_id as string | null) ?? null,
      metadata: row.metadata_json ? (JSON.parse(row.metadata_json as string) as JsonValue) : null,
      syncState: row.sync_state as 'synced' | 'stale' | 'error',
      lastSyncedAt: (row.last_synced_at as string | null) ?? null,
      addedBy: row.added_by as 'agent' | 'user',
      createdAt: row.created_at as string,
      updatedAt: (row.updated_at as string | null) ?? null,
    };
  }

  private mustGetReference(id: string): ReferenceView {
    const row = this.sql.exec(`SELECT * FROM card_references WHERE id = ?`, id).toArray()[0];
    if (!row) throw new Error(`invariant violation: reference ${id} missing immediately after write`);
    return this.rowToReference(row);
  }

  private allReferences(): ReferenceView[] {
    return this.sql
      .exec(`SELECT * FROM card_references ORDER BY created_at ASC`)
      .toArray()
      .map((r) => this.rowToReference(r));
  }

  private snapshot(): BoardSnapshot {
    const boardId = this.getMeta('boardId');
    return {
      boardId,
      tenantId: this.getMeta('tenantId'),
      name: this.getMeta('name'),
      stages: this.stages(),
      cards: boardId ? this.allCards() : [],
      gates: boardId ? this.pendingGates() : [],
      references: boardId ? this.allReferences() : [],
    };
  }

  private now(): string {
    return new Date().toISOString();
  }

  private nowMs(): number {
    return Date.now();
  }
}
