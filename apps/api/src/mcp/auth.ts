/**
 * MCP OAuth 2.1 Resource Server (docs/05 §2). Kaambaan validates audience-scoped bearer tokens and,
 * when none is present, returns 401 + WWW-Authenticate so a client can discover the protected-resource
 * metadata (RFC 9728) and run the authorization flow.
 *
 * P4 uses a dev-mode bearer — "<tenantId>:<agentId>:<comma-separated-capabilities>" — mirroring the
 * dev-mode X-Tenant-Id/X-Agent-Id headers the rest of the API uses today. A real Authorization Server
 * (PKCE / dynamic client registration via @cloudflare/workers-oauth-provider) is a fast-follow; only
 * `resolveBearer` changes when it lands.
 */
import type { McpAuth } from './tools';

const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource';

/** Parse the dev bearer into a principal, or null if absent/malformed. */
export function resolveBearer(request: Request): McpAuth | null {
  const header = request.headers.get('Authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const [tenantId, agentId, capsRaw] = match[1]!.trim().split(':');
  if (!tenantId || !agentId) return null;
  const capabilities = capsRaw ? capsRaw.split(',').map((c) => c.trim()).filter(Boolean) : [];
  return { tenantId, agentId, capabilities };
}

/** 401 challenge that points the client at the protected-resource metadata (docs/05 §2). */
export function unauthorized(request: Request): Response {
  const metadata = `${new URL(request.url).origin}${PROTECTED_RESOURCE_PATH}`;
  return new Response(JSON.stringify({ error: 'unauthorized', error_description: 'A bearer token is required.' }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer resource_metadata="${metadata}"`,
    },
  });
}

/** OAuth 2.0 Protected Resource Metadata (RFC 9728). */
export function protectedResourceMetadata(request: Request): Response {
  const origin = new URL(request.url).origin;
  return Response.json({
    resource: `${origin}/mcp`,
    // The Authorization Server is co-located for now; replaced by a dedicated AS when OAuth lands.
    authorization_servers: [origin],
    bearer_methods_supported: ['header'],
    resource_name: 'Kaambaan board worker',
  });
}

export const MCP_PROTECTED_RESOURCE_PATH = PROTECTED_RESOURCE_PATH;
