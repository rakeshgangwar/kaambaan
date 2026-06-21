import { env } from 'cloudflare:test';
import { beforeAll, describe, it, expect } from 'vitest';
import { setupCatalog } from './helpers/catalog';
import {
  upsertUserByEmail,
  ensurePersonalWorkspace,
  primaryTenant,
  createAgent,
  createAgentToken,
  findAgentByTokenHash,
  recordBoard,
  listBoards,
  listAgents,
  deleteBoard,
  deleteAgent,
} from '../src/db/catalog';
import { hashToken } from '../src/auth/agent-token';

beforeAll(setupCatalog);

describe('catalog (D1) — auth, workspaces, agent tokens', () => {
  it('upserts a user by email idempotently', async () => {
    const u1 = await upsertUserByEmail(env.DB, { email: 'ada@x.com', name: 'Ada' });
    const u2 = await upsertUserByEmail(env.DB, { email: 'ada@x.com', name: 'Ada Lovelace' });
    expect(u2.id).toBe(u1.id);
    expect(u2.name).toBe('Ada Lovelace');
  });

  it('bootstraps a personal workspace (owner) on first sign-in, idempotently', async () => {
    const u = await upsertUserByEmail(env.DB, { email: 'grace@x.com', name: 'Grace' });
    const t1 = await ensurePersonalWorkspace(env.DB, u.id, 'Grace');
    const t2 = await ensurePersonalWorkspace(env.DB, u.id, 'Grace');
    expect(t1.id).toBe(t2.id);
    expect(t1.name).toBe("Grace's workspace");
    expect((await primaryTenant(env.DB, u.id))?.id).toBe(t1.id);
  });

  it('mints an agent token and resolves it by hash (tenant + capabilities)', async () => {
    const u = await upsertUserByEmail(env.DB, { email: 'lin@x.com', name: 'Lin' });
    const t = await ensurePersonalWorkspace(env.DB, u.id, 'Lin');
    const agent = await createAgent(env.DB, t.id, { name: 'Research bot', capabilities: ['research', 'publish'] });
    const { token } = await createAgentToken(env.DB, t.id, agent.id, ['claim']);
    expect(token.startsWith('kbn_')).toBe(true);

    const resolved = await findAgentByTokenHash(env.DB, await hashToken(token));
    expect(resolved).toMatchObject({ tenantId: t.id, agentId: agent.id, capabilities: ['research', 'publish'], scopes: ['claim'] });
    // a bogus / revoked token resolves to nothing
    expect(await findAgentByTokenHash(env.DB, await hashToken('kbn_bogus'))).toBeNull();
  });

  it("records and lists a workspace's boards (tenant-scoped)", async () => {
    const u = await upsertUserByEmail(env.DB, { email: 'mae@x.com', name: 'Mae' });
    const t = await ensurePersonalWorkspace(env.DB, u.id, 'Mae');
    await recordBoard(env.DB, t.id, { id: 'brd_cat1', name: 'Launch', stagesJson: '[]' });
    expect(await listBoards(env.DB, t.id)).toEqual([{ id: 'brd_cat1', name: 'Launch' }]);
    // another workspace sees none of it
    const other = await ensurePersonalWorkspace(env.DB, (await upsertUserByEmail(env.DB, { email: 'x@x.com' })).id, 'X');
    expect(await listBoards(env.DB, other.id)).toEqual([]);
  });

  it('deletes a board, and deletes an agent with its tokens (so the token stops resolving)', async () => {
    const u = await upsertUserByEmail(env.DB, { email: 'del@x.com', name: 'Del' });
    const t = await ensurePersonalWorkspace(env.DB, u.id, 'Del');

    await recordBoard(env.DB, t.id, { id: 'brd_del', name: 'Del board', stagesJson: '[]' });
    await deleteBoard(env.DB, t.id, 'brd_del');
    expect(await listBoards(env.DB, t.id)).toEqual([]);

    const agent = await createAgent(env.DB, t.id, { name: 'Bot', capabilities: ['research'] });
    const { token } = await createAgentToken(env.DB, t.id, agent.id, ['claim']);
    expect((await listAgents(env.DB, t.id)).length).toBe(1);

    await deleteAgent(env.DB, t.id, agent.id);
    expect(await listAgents(env.DB, t.id)).toEqual([]);
    expect(await findAgentByTokenHash(env.DB, await hashToken(token))).toBeNull();
  });
});
