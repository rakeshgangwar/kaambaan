import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { env } from 'cloudflare:test';
import { registerKaambaanTools, type ToolDeps, type McpAuth } from '../../src/mcp/tools';
import type { BoardStub, BoardInit } from '../../src/board/board-do';

/** Build the tool dependencies against the real Board DO, scoped to one tenant (as the Worker does). */
export function depsFor(auth: McpAuth, boards: Array<{ id: string; name: string }> = []): ToolDeps {
  return {
    auth,
    boardStub: (boardId: string) =>
      env.BOARD_DO.get(env.BOARD_DO.idFromName(`${auth.tenantId}:${boardId}`)) as unknown as BoardStub,
    listBoards: async () => boards,
  };
}

/** Connect an in-memory MCP client to a server wired with the Kaambaan tools (docs/09 — test the real surface). */
export async function connectMcp(deps: ToolDeps): Promise<Client> {
  const server = new McpServer({ name: 'kaambaan', version: '0.0.0' });
  registerKaambaanTools(server, deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'mcp-test', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

/** Initialize a board on its DO and return a stub for further direct setup. */
export async function initBoard(auth: McpAuth, boardId: string, stages: BoardInit['stages'], name = 'Board'): Promise<BoardStub> {
  const stub = depsFor(auth).boardStub(boardId);
  await stub.init({ id: boardId, tenantId: auth.tenantId, name, stages });
  return stub;
}

/** Parse a tool call's text content as JSON. */
export function toolJson(result: unknown): unknown {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  const text = content.find((c) => c.type === 'text')?.text ?? '';
  return JSON.parse(text);
}

export const RESEARCH_PIPELINE: BoardInit['stages'] = [
  { key: 'research', name: 'Research', order: 0, ownerKind: 'capability', owner: 'research' },
  { key: 'review', name: 'Review', order: 1, ownerKind: 'human', gate: 'approval' },
  { key: 'publish', name: 'Publish', order: 2, ownerKind: 'capability', owner: 'publish' },
];
