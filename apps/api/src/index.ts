/**
 * Kaambaan API — the edge Worker (docs/02-architecture.md). For P0 this is a health endpoint plus
 * the scaffolding for the auth + tenant-isolation layer. Routing to the Board Durable Object and
 * the MCP/REST verb surfaces arrives in P1–P4.
 */
export interface Env {
  DB: D1Database;
}

export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ ok: true, service: 'kaambaan-api', phase: 'P0' });
    }

    return new Response('Not Found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
