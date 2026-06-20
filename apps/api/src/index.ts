/**
 * Kaambaan API — the edge Worker (docs/02-architecture.md). It authenticates, resolves the tenant,
 * and routes board requests to the per-(tenant, board) Board Durable Object. P1 exposes a
 * human-driven board (create/list/move cards) plus the live WebSocket feed.
 *
 * Auth note: P1 uses a dev-mode `X-Tenant-Id` header to scope requests. Real human login
 * (OAuth/magic-link → session) replaces it without changing the routing/isolation model.
 */
import {
  BoardDO,
  type StageDef,
  type BoardSnapshot,
  type BoardStub,
  type BoardErrorCode,
  type JsonValue,
} from './board/board-do';
import type { Env } from './env';
import { newId } from './ids';

export { BoardDO };

function tenantFrom(request: Request): string | null {
  const header = request.headers.get('X-Tenant-Id');
  if (header && header.trim() !== '') return header;
  // Browsers can't set headers on a WebSocket upgrade, so allow ?tenant= for the dev feed.
  const query = new URL(request.url).searchParams.get('tenant');
  return query && query.trim() !== '' ? query : null;
}

function boardStub(env: Env, tenantId: string, boardId: string): BoardStub {
  // The DO name binds tenant + board, so an instance can never serve two tenants (docs/02).
  return env.BOARD_DO.get(env.BOARD_DO.idFromName(`${tenantId}:${boardId}`)) as unknown as BoardStub;
}

function statusForCode(code: BoardErrorCode): number {
  switch (code) {
    case 'WIP_LIMIT':
      return 409;
    case 'UNKNOWN_STAGE':
      return 400;
    case 'CARD_NOT_FOUND':
    case 'NOT_INITIALIZED':
      return 404;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'GET' && path === '/health') {
      return Response.json({ ok: true, service: 'kaambaan-api', phase: 'P1' });
    }

    const match = path.match(/^\/v1\/boards(?:\/([^/]+))?(?:\/(.*))?$/);
    if (!match) return new Response('Not Found', { status: 404 });

    const tenantId = tenantFrom(request);
    if (!tenantId) return Response.json({ error: 'X-Tenant-Id required' }, { status: 401 });

    const boardId = match[1];
    const rest = match[2] ?? '';

    try {
      // POST /v1/boards — create a board
      if (!boardId) {
        if (request.method !== 'POST') return Response.json({ error: 'method not allowed' }, { status: 405 });
        const body = (await request.json()) as { name: string; stages: StageDef[] };
        const id = newId('brd');
        const snapshot = await boardStub(env, tenantId, id).init({ id, tenantId, name: body.name, stages: body.stages });
        return Response.json({ boardId: id, board: snapshot }, { status: 201 });
      }

      const stub = boardStub(env, tenantId, boardId);

      // GET /v1/boards/:id/ws — live feed (WebSocket upgrade forwarded to the DO)
      if (rest === 'ws') return stub.fetch(request);

      // GET /v1/boards/:id — board snapshot
      if (rest === '' && request.method === 'GET') {
        const snapshot: BoardSnapshot = await stub.getState();
        if (!snapshot.boardId) return Response.json({ error: 'board not found' }, { status: 404 });
        return Response.json(snapshot);
      }

      // POST /v1/boards/:id/cards — create a card
      if (rest === 'cards' && request.method === 'POST') {
        const body = (await request.json()) as {
          title: string;
          ownerUserId: string;
          spec?: JsonValue;
          priority?: number;
        };
        const result = await stub.createCard(body);
        if (!result.ok) return Response.json({ error: result }, { status: statusForCode(result.code) });
        return Response.json({ card: result.value }, { status: 201 });
      }

      // POST /v1/boards/:id/cards/:cardId/move — move a card
      const moveMatch = rest.match(/^cards\/([^/]+)\/move$/);
      if (moveMatch && request.method === 'POST') {
        const body = (await request.json()) as { toStageKey: string };
        const result = await stub.moveCard(moveMatch[1]!, body.toStageKey);
        if (!result.ok) return Response.json({ error: result }, { status: statusForCode(result.code) });
        return Response.json({ card: result.value });
      }

      return Response.json({ error: 'method not allowed' }, { status: 405 });
    } catch (err) {
      const message = (err as { message?: string })?.message ?? 'unexpected error';
      return Response.json({ error: { message } }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
