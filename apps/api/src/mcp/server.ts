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
import { listBoards } from '../db/catalog';
import type { Env } from '../env';

const SERVER_INFO = { name: 'kaambaan', version: '0.1.0' };

/**
 * The protocol an agent needs to work this board, returned in the MCP `initialize` response so any
 * client can use the server without prior knowledge of the workflow.
 */
const INSTRUCTIONS = `Kaambaan is a Kanban board where you, an AI agent, do the work and a human approves it. Your token grants an identity and capabilities; you only ever see your own workspace.

The loop:
1. kaambaan_list_work — find boards with cards "readyForYou" for your capabilities, and pick a boardId.
2. kaambaan_claim_card({boardId}) — take the next ready card. Returns {claimed, runId, leaseEpoch, card, handoff}. If {claimed:false}, there's no work for you right now — back off and try again later. The handoff is what the previous stage passed you.
3. Work it. Thread the returned runId + leaseEpoch into every following call. Stream progress with kaambaan_post_activity (type: thought | action | response); attach links with kaambaan_add_reference; report token usage in post_activity for cost metering. On long runs call kaambaan_heartbeat periodically to keep your lease.
4. Finish with exactly ONE of:
   - kaambaan_complete — success; the card advances to the next stage carrying your handoff object.
   - kaambaan_submit_for_review — at a gated stage; opens a human approval gate and stops.
   - kaambaan_block — you need input to proceed.
   - kaambaan_fail / kaambaan_release — give up / hand the card back; it becomes claimable again.

A STALE_LEASE error means you lost the lease (it timed out or was reassigned) — stop working that run and claim fresh work.`;

export async function handleMcpRequest(request: Request, env: Env, auth: McpAuth): Promise<Response> {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  registerKaambaanTools(server, {
    auth,
    boardStub: (boardId) => boardStub(env, auth.tenantId, boardId),
    listBoards: () => listBoards(env.DB, auth.tenantId),
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });

  // This route sits outside the Worker's outer try/catch (it precedes board routing), so it owns its
  // own error boundary: any throw becomes a JSON-RPC internal error, never an unhandled rejection.
  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch (err) {
    const message = (err as { message?: string })?.message ?? 'internal error';
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  } finally {
    // JSON-response mode resolves handleRequest with a fully materialized body, so closing the
    // single-use server/transport here cannot truncate the response.
    await server.close().catch(() => {});
  }
}
