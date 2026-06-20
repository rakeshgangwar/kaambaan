import { DurableObject } from 'cloudflare:workers';
import type { TaskState } from '@kaambaan/contract';
import type { Env } from '../env';
import { newId } from '../ids';

/** JSON-serializable value — used for everything that crosses the Durable Object RPC boundary. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** A pipeline stage (board column) as held by the DO. */
export interface StageDef {
  key: string;
  name: string;
  order: number;
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

export interface BoardSnapshot {
  boardId: string | null;
  tenantId: string | null;
  name: string | null;
  stages: StageDef[];
  cards: CardView[];
}

/**
 * Business outcomes are returned as values (not thrown). Throwing across the Durable Object RPC
 * boundary surfaces as an unhandled rejection in the runtime, so expected failures (WIP limits,
 * unknown stages, …) are modeled explicitly (docs/03 — illegal moves; WIP limits).
 */
export type BoardErrorCode = 'NOT_INITIALIZED' | 'UNKNOWN_STAGE' | 'WIP_LIMIT' | 'CARD_NOT_FOUND';

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
  fetch(request: Request): Promise<Response>;
}

/**
 * Board Durable Object — one instance per (tenant, board). The single-threaded DO is the live
 * authority for the board: it owns the card state in DO SQLite, appends an event log, and fans
 * events out to connected UI clients over a hibernatable WebSocket (docs/02, docs/07).
 *
 * For P1 the board is human-driven (cards are created and moved by people). Agent claims and the
 * full task/run lifecycle arrive in P2.
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
        created_at TEXT NOT NULL,
        updated_at TEXT
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
  }

  // ----- RPC: lifecycle -----

  /** Idempotently initialize the board with its tenant and pipeline. */
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
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.title,
      JSON.stringify(input.spec ?? {}),
      input.ownerUserId,
      first.key,
      'submitted',
      input.priority ?? 0,
      contextId,
      now,
      now,
    );
    const card = this.mustGetCard(id);
    this.emit('card.created', { card });
    return { ok: true, value: card };
  }

  /** Move a card to another stage. Enforces stage existence and the target stage's WIP limit. */
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
    this.emit('card.moved', { cardId, from: card.currentStageKey, to: target.key, by: actorUserId ?? null });
    return { ok: true, value: updated };
  }

  async getState(): Promise<BoardSnapshot> {
    return this.snapshot();
  }

  /** Recent events, oldest first. */
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
    // P1: the board is read-only over WebSocket; mutations go through the REST verbs.
  }

  webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean): void {
    try {
      ws.close(code);
    } catch {
      // already closed
    }
  }

  // ----- internals -----

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
    const row = this.sql.exec(`SELECT COUNT(*) AS n FROM cards WHERE current_stage_key = ?`, stageKey).one();
    return Number(row.n);
  }

  private getCard(id: string): CardView | null {
    const row = this.sql.exec(`SELECT * FROM cards WHERE id = ?`, id).toArray()[0];
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

  private rowToCard(row: Record<string, SqlStorageValue>): CardView {
    return {
      id: row.id as string,
      title: row.title as string,
      spec: JSON.parse(row.spec_json as string),
      ownerUserId: row.owner_user_id as string,
      currentStageKey: row.current_stage_key as string,
      state: row.state as TaskState,
      priority: Number(row.priority),
      contextId: row.context_id as string,
      createdAt: row.created_at as string,
      updatedAt: (row.updated_at as string | null) ?? null,
    };
  }

  private snapshot(): BoardSnapshot {
    const boardId = this.getMeta('boardId');
    return {
      boardId,
      tenantId: this.getMeta('tenantId'),
      name: this.getMeta('name'),
      stages: this.stages(),
      cards: boardId ? this.allCards() : [],
    };
  }

  private now(): string {
    return new Date().toISOString();
  }
}
