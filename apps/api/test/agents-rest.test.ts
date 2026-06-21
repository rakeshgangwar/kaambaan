import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

const RESEARCH_PIPELINE = [
  { key: 'research', name: 'Research', order: 0, ownerKind: 'capability', owner: 'research' },
  { key: 'done', name: 'Done', order: 1, ownerKind: 'human' },
];

const dev = (tenant: string) => ({ 'X-Tenant-Id': tenant, 'Content-Type': 'application/json' });

async function createBoard(tenant: string): Promise<string> {
  const res = await SELF.fetch('https://api.test/v1/boards', { method: 'POST', headers: dev(tenant), body: JSON.stringify({ name: 'B', stages: RESEARCH_PIPELINE }) });
  return (await res.json<{ boardId: string }>()).boardId;
}

describe('REST — /v1/agents (mint token + real-token auth)', () => {
  it('mints an agent token that then authenticates a real claim (no dev headers)', async () => {
    const created = await SELF.fetch('https://api.test/v1/agents', {
      method: 'POST',
      headers: dev('tnt_agents'),
      body: JSON.stringify({ name: 'Research bot', capabilities: ['research'] }),
    });
    expect(created.status).toBe(201);
    const { token } = await created.json<{ agent: { id: string }; token: string }>();
    expect(token).toMatch(/^kbn_/);

    const boardId = await createBoard('tnt_agents');
    await SELF.fetch(`https://api.test/v1/boards/${boardId}/cards`, { method: 'POST', headers: dev('tnt_agents'), body: JSON.stringify({ title: 'Investigate' }) });

    // Claim with ONLY the real bearer token — capabilities come from the token's agent (catalog).
    const claimRes = await SELF.fetch(`https://api.test/v1/boards/${boardId}/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const claim = await claimRes.json<{ claimed: boolean; runId?: string }>();
    expect(claim.claimed).toBe(true); // the token alone authorized the claim
    expect(claim.runId).toBeTruthy();
  });

  it('lists the workspace agents and rejects an unauthenticated mint', async () => {
    await SELF.fetch('https://api.test/v1/agents', { method: 'POST', headers: dev('tnt_list'), body: JSON.stringify({ name: 'Bot A' }) });
    const list = await SELF.fetch('https://api.test/v1/agents', { headers: dev('tnt_list') });
    expect((await list.json<{ agents: unknown[] }>()).agents.length).toBe(1);

    const noAuth = await SELF.fetch('https://api.test/v1/agents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'X' }) });
    expect(noAuth.status).toBe(401);
  });

  it('deletes a board and an agent via REST (DELETE)', async () => {
    const boardId = await createBoard('tnt_mgmt');
    const delBoard = await SELF.fetch(`https://api.test/v1/boards/${boardId}`, { method: 'DELETE', headers: dev('tnt_mgmt') });
    expect(delBoard.status).toBe(204);
    expect((await (await SELF.fetch('https://api.test/v1/boards', { headers: dev('tnt_mgmt') })).json<{ boards: unknown[] }>()).boards).toEqual([]);

    const created = await (await SELF.fetch('https://api.test/v1/agents', { method: 'POST', headers: dev('tnt_mgmt'), body: JSON.stringify({ name: 'Bot' }) })).json<{ agent: { id: string } }>();
    const delAgent = await SELF.fetch(`https://api.test/v1/agents/${created.agent.id}`, { method: 'DELETE', headers: dev('tnt_mgmt') });
    expect(delAgent.status).toBe(204);
    expect((await (await SELF.fetch('https://api.test/v1/agents', { headers: dev('tnt_mgmt') })).json<{ agents: unknown[] }>()).agents).toEqual([]);
  });
});
