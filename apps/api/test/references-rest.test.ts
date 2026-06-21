import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

const T = { 'X-Tenant-Id': 'tnt_rest', 'Content-Type': 'application/json' };
const base = 'https://api.test';

async function seedBoardCard(): Promise<{ boardId: string; cardId: string }> {
  const board = (await (
    await SELF.fetch(`${base}/v1/boards`, {
      method: 'POST',
      headers: T,
      body: JSON.stringify({ name: 'R', stages: [{ key: 'backlog', name: 'Backlog', order: 0 }] }),
    })
  ).json()) as { boardId: string };
  const card = (await (
    await SELF.fetch(`${base}/v1/boards/${board.boardId}/cards`, {
      method: 'POST',
      headers: T,
      body: JSON.stringify({ title: 'C', ownerUserId: 'usr_a' }),
    })
  ).json()) as { card: { id: string } };
  return { boardId: board.boardId, cardId: card.card.id };
}

describe('REST — PUT /v1/boards/:id/cards/:cardId/references', () => {
  it('upserts a reference idempotently and auto-enriches a GitHub url', async () => {
    const { boardId, cardId } = await seedBoardCard();
    const put = (body: unknown) =>
      SELF.fetch(`${base}/v1/boards/${boardId}/cards/${cardId}/references`, { method: 'PUT', headers: T, body: JSON.stringify(body) });

    const r1 = await put({ url: 'https://github.com/org/repo/pull/42' });
    expect(r1.status).toBe(200);
    const ref1 = ((await r1.json()) as { reference: any }).reference;
    expect(ref1).toMatchObject({ provider: 'github', sourceType: 'pull_request', externalId: 'org/repo#42', addedBy: 'agent' });

    const r2 = await put({ url: 'https://github.com/org/repo/pull/42', title: 'updated' });
    const ref2 = ((await r2.json()) as { reference: any }).reference;
    expect(ref2.id).toBe(ref1.id); // idempotent — same reference

    const snap = (await (await SELF.fetch(`${base}/v1/boards/${boardId}`, { headers: T })).json()) as {
      references: Array<{ title: string }>;
    };
    expect(snap.references).toHaveLength(1);
    expect(snap.references[0]!.title).toBe('updated');
  });

  it('records caller-supplied provenance and explicit provider/sourceType', async () => {
    const { boardId, cardId } = await seedBoardCard();
    const res = await SELF.fetch(`${base}/v1/boards/${boardId}/cards/${cardId}/references`, {
      method: 'PUT',
      headers: T,
      body: JSON.stringify({ url: 'https://docs.example.com/spec', provider: 'docs', sourceType: 'doc', addedBy: 'user' }),
    });
    const ref = ((await res.json()) as { reference: any }).reference;
    expect(ref).toMatchObject({ provider: 'docs', sourceType: 'doc', addedBy: 'user' });
  });

  it('404s a reference on an unknown card', async () => {
    const { boardId } = await seedBoardCard();
    const res = await SELF.fetch(`${base}/v1/boards/${boardId}/cards/card_nope/references`, {
      method: 'PUT',
      headers: T,
      body: JSON.stringify({ url: 'https://x.y' }),
    });
    expect(res.status).toBe(404);
  });

  it('requires a tenant header', async () => {
    const { boardId, cardId } = await seedBoardCard();
    const res = await SELF.fetch(`${base}/v1/boards/${boardId}/cards/${cardId}/references`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://x.y' }),
    });
    expect(res.status).toBe(401);
  });
});
