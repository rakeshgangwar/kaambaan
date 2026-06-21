/**
 * MCP server over Streamable HTTP (docs/05 §2, docs/10 P4). Each request gets a fresh McpServer wired
 * to the SDK's Web-Standard transport in **stateless** mode: our tools are thin RPC calls into the
 * per-(tenant, board) Board DO, so there is no MCP-session state worth keeping in the Worker — the
 * authority is the DO. The authenticated principal is bound into the tools' board-stub accessor, so a
 * token can only ever reach its own tenant's boards.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { registerKaambaanTools, type McpAuth } from './tools';
import { boardStub } from '../board/stub';
import type { Env } from '../env';

const SERVER_INFO = { name: 'kaambaan', version: '0.1.0' };

export async function handleMcpRequest(request: Request, env: Env, auth: McpAuth): Promise<Response> {
  const server = new McpServer(SERVER_INFO);
  registerKaambaanTools(server, {
    auth,
    boardStub: (boardId) => boardStub(env, auth.tenantId, boardId),
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}
