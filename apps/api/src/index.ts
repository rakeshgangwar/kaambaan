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
  type BoardErrorCode,
  type AgentActivityType,
  type GateDecision,
  type Result,
  type JsonValue,
} from './board/board-do';
import type { Env } from './env';
import { newId } from './ids';
import { boardStub } from './board/stub';
import { resolveReferenceInput } from './references/resolve';
import { handleMcpRequest } from './mcp/server';
import { resolveBearer, unauthorized, protectedResourceMetadata, MCP_PROTECTED_RESOURCE_PATH } from './mcp/auth';

export { BoardDO };

function tenantFrom(request: Request): string | null {
  const header = request.headers.get('X-Tenant-Id');
  if (header && header.trim() !== '') return header;
  // Browsers can't set headers on a WebSocket upgrade, so allow ?tenant= for the dev feed.
  const query = new URL(request.url).searchParams.get('tenant');
  return query && query.trim() !== '' ? query : null;
}

function statusForCode(code: BoardErrorCode): number {
  switch (code) {
    case 'WIP_LIMIT':
      return 409;
    case 'UNKNOWN_STAGE':
    case 'INVALID_URL':
      return 400;
    case 'CARD_NOT_FOUND':
    case 'NOT_INITIALIZED':
    case 'GATE_NOT_FOUND':
      return 404;
    case 'STALE_LEASE':
    case 'GATE_NOT_PENDING':
      return 409;
    case 'SEPARATION_OF_DUTIES':
      return 403;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'GET' && path === '/health') {
      return Response.json({ ok: true, service: 'kaambaan-api', phase: 'P4' });
    }

    // MCP surface (docs/05 §2): an OAuth Resource Server in front of the Streamable HTTP endpoint.
    if (request.method === 'GET' && path === MCP_PROTECTED_RESOURCE_PATH) {
      return protectedResourceMetadata(request);
    }
    if (path === '/mcp') {
      const auth = resolveBearer(request);
      if (!auth) return unauthorized(request);
      return handleMcpRequest(request, env, auth);
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

      // PUT /v1/boards/:id/cards/:cardId/references — idempotent reference upsert (docs/06 §1)
      const refMatch = rest.match(/^cards\/([^/]+)\/references$/);
      if (refMatch && request.method === 'PUT') {
        const body = (await request.json()) as {
          url: string;
          provider?: string;
          sourceType?: string;
          title?: string;
          subtitle?: string;
          externalId?: string;
          metadata?: Record<string, unknown>;
          addedBy?: 'agent' | 'user';
        };
        const result = await stub.addReference(resolveReferenceInput({ cardId: refMatch[1]!, ...body }));
        if (!result.ok) return Response.json({ error: result }, { status: statusForCode(result.code) });
        return Response.json({ reference: result.value });
      }

      // POST /v1/boards/:id/claims — an agent claims a ready card (docs/04 §3)
      if (rest === 'claims' && request.method === 'POST') {
        const agentId = request.headers.get('X-Agent-Id');
        if (!agentId || agentId.trim() === '') {
          return Response.json({ error: 'X-Agent-Id required' }, { status: 400 });
        }
        const payload = (await request.json()) as { capabilities?: string[]; maxConcurrency?: number };
        const claimResult = await stub.claim({
          agentId,
          capabilities: payload.capabilities ?? [],
          maxConcurrency: payload.maxConcurrency,
        });
        return Response.json(claimResult);
      }

      // POST /v1/boards/:id/runs/:runId/:action — agent run verbs (docs/04 §3)
      const runMatch = rest.match(/^runs\/([^/]+)\/([^/]+)$/);
      if (runMatch && request.method === 'POST') {
        const runId = runMatch[1]!;
        const action = runMatch[2]!;
        const p = (await request.json()) as {
          leaseEpoch: number;
          type?: AgentActivityType;
          ephemeral?: boolean;
          body?: string;
          action?: string;
          parameter?: JsonValue;
          result?: JsonValue;
          signal?: string;
          handoff?: JsonValue;
          output?: JsonValue;
          reason?: string;
        };
        const respond = (r: Result<unknown>, key: string): Response =>
          r.ok
            ? Response.json({ [key]: r.value })
            : Response.json({ error: r }, { status: statusForCode(r.code) });

        switch (action) {
          case 'heartbeat':
            return respond(await stub.heartbeat({ runId, leaseEpoch: p.leaseEpoch }), 'run');
          case 'activities':
            return respond(
              await stub.postActivity({
                runId,
                leaseEpoch: p.leaseEpoch,
                type: p.type ?? 'thought',
                ephemeral: p.ephemeral,
                body: p.body,
                action: p.action,
                parameter: p.parameter,
                result: p.result,
                signal: p.signal,
              }),
              'activity',
            );
          case 'complete':
            return respond(await stub.complete({ runId, leaseEpoch: p.leaseEpoch, handoff: p.handoff }), 'card');
          case 'block':
            return respond(await stub.block({ runId, leaseEpoch: p.leaseEpoch, reason: p.reason ?? '' }), 'card');
          case 'fail':
            return respond(await stub.fail({ runId, leaseEpoch: p.leaseEpoch, reason: p.reason ?? '' }), 'card');
          case 'release':
            return respond(await stub.release({ runId, leaseEpoch: p.leaseEpoch }), 'card');
          case 'submit':
            return respond(await stub.submitForReview({ runId, leaseEpoch: p.leaseEpoch, output: p.output }), 'card');
          default:
            return Response.json({ error: `unknown run action: ${action}` }, { status: 404 });
        }
      }

      // POST /v1/boards/:id/gates/:gateId/resolve — a human resolves an approval gate (docs/08 §6)
      const gateMatch = rest.match(/^gates\/([^/]+)\/resolve$/);
      if (gateMatch && request.method === 'POST') {
        const decidedBy = request.headers.get('X-User-Id');
        if (!decidedBy || decidedBy.trim() === '') {
          return Response.json({ error: 'X-User-Id required' }, { status: 400 });
        }
        const gp = (await request.json()) as { decision: GateDecision; comment?: string };
        const result = await stub.resolveGate({
          gateId: gateMatch[1]!,
          decision: gp.decision,
          decidedBy,
          comment: gp.comment,
        });
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
