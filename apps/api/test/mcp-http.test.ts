import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { initBoard, RESEARCH_PIPELINE } from './helpers/mcp';

/**
 * The MCP wire (docs/05 §2): Streamable HTTP at /mcp behind an OAuth 2.1 Resource Server.
 * Unauthenticated → 401 + WWW-Authenticate pointing at the protected-resource metadata; a valid
 * bearer resolves to {tenant, agent, capabilities} and drives the same tools as the in-process tests.
 */
const base = 'https://api.test';
const PROTO = '2025-06-18';
// Dev bearer scheme (Resource Server): "<tenantId>:<agentId>:<comma-separated-capabilities>".
const TOKEN = 'tnt_http:agt_h:research';

const POST_HEADERS = (extra: Record<string, string> = {}) => ({
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
  ...extra,
});

async function rpc(res: Response): Promise<{ id: number; result?: any; error?: any }> {
  const body = (await res.json()) as unknown;
  return (Array.isArray(body) ? body[0] : body) as { id: number; result?: any; error?: any };
}

describe('MCP server — OAuth Resource Server', () => {
  it('rejects an unauthenticated /mcp request with 401 + WWW-Authenticate', async () => {
    const res = await SELF.fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    expect(res.status).toBe(401);
    const wwwAuth = res.headers.get('WWW-Authenticate') ?? '';
    expect(wwwAuth).toMatch(/^Bearer/);
    expect(wwwAuth).toContain('resource_metadata=');
  });

  it('rejects malformed bearer tokens (loud failure, not silent scope-drop)', async () => {
    for (const bad of ['garbage', 'tnt_only', ':agt:caps', 'tnt::caps', 'a:b:c:d']) {
      const res = await SELF.fetch(`${base}/mcp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bad}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      });
      expect(res.status, `token "${bad}" should be rejected`).toBe(401);
    }
  });

  it('serves OAuth protected-resource metadata (RFC 9728)', async () => {
    const res = await SELF.fetch(`${base}/.well-known/oauth-protected-resource`);
    expect(res.status).toBe(200);
    const meta = (await res.json()) as { resource: string; authorization_servers: string[] };
    expect(meta.resource).toBe(`${base}/mcp`);
    expect(Array.isArray(meta.authorization_servers)).toBe(true);
    expect(meta.authorization_servers.length).toBeGreaterThan(0);
  });
});

describe('MCP server — Streamable HTTP transport', () => {
  it('completes the MCP initialize handshake', async () => {
    const res = await SELF.fetch(`${base}/mcp`, {
      method: 'POST',
      headers: POST_HEADERS(),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: PROTO, capabilities: {}, clientInfo: { name: 'test', version: '0' } },
      }),
    });
    expect(res.status).toBe(200);
    const { result } = await rpc(res);
    expect(result.serverInfo.name).toBe('kaambaan');
    expect(result.capabilities.tools).toBeDefined();
    // The server is self-describing: the workflow protocol ships in `instructions` so any client can
    // use it without prior knowledge.
    expect(result.instructions).toContain('kaambaan_list_work');
    expect(result.instructions).toContain('kaambaan_claim_card');
  });

  it('lists tools over HTTP', async () => {
    const res = await SELF.fetch(`${base}/mcp`, {
      method: 'POST',
      headers: POST_HEADERS({ 'Mcp-Protocol-Version': PROTO }),
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    expect(res.status).toBe(200);
    const { result } = await rpc(res);
    const names = (result.tools as Array<{ name: string }>).map((t) => t.name);
    expect(names).toContain('kaambaan_claim_card');
    expect(names).toContain('kaambaan_complete');
  });

  it('claims a card over HTTP, scoped to the bearer\'s tenant + capabilities', async () => {
    const stub = await initBoard({ tenantId: 'tnt_http', agentId: 'agt_h', capabilities: ['research'] }, 'brd_http', RESEARCH_PIPELINE);
    await stub.createCard({ title: 'Drive me over MCP', ownerUserId: 'usr_a' });

    const res = await SELF.fetch(`${base}/mcp`, {
      method: 'POST',
      headers: POST_HEADERS({ 'Mcp-Protocol-Version': PROTO }),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'kaambaan_claim_card', arguments: { boardId: 'brd_http' } },
      }),
    });
    expect(res.status).toBe(200);
    const { result } = await rpc(res);
    expect(result.isError).toBeFalsy();
    const claim = JSON.parse(result.content[0].text) as { claimed: boolean; card?: { title: string } };
    expect(claim.claimed).toBe(true);
    expect(claim.card?.title).toBe('Drive me over MCP');
  });

  it('rejects a bearer for the wrong tenant (cannot reach another tenant\'s board)', async () => {
    const stub = await initBoard({ tenantId: 'tnt_owner', agentId: 'agt_o', capabilities: ['research'] }, 'brd_owned', RESEARCH_PIPELINE);
    await stub.createCard({ title: 'Owned', ownerUserId: 'usr_a' });

    // TOKEN is tnt_http — a different tenant — so it addresses a different (empty) DO, never tnt_owner's board.
    const res = await SELF.fetch(`${base}/mcp`, {
      method: 'POST',
      headers: POST_HEADERS({ 'Mcp-Protocol-Version': PROTO }),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'kaambaan_claim_card', arguments: { boardId: 'brd_owned' } },
      }),
    });
    const { result } = await rpc(res);
    expect(JSON.parse(result.content[0].text)).toEqual({ claimed: false });
  });
});
