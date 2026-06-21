import { SELF } from 'cloudflare:test';
import { describe, it, expect, vi } from 'vitest';

const STAGES = [
  { key: 'backlog', name: 'Backlog', order: 0 },
  { key: 'doing', name: 'Doing', order: 1, wipLimit: 1 },
  { key: 'done', name: 'Done', order: 2 },
];

function headers(tenant = 'tnt_a'): Record<string, string> {
  return { 'X-Tenant-Id': tenant, 'Content-Type': 'application/json' };
}

async function createBoard(tenant = 'tnt_a'): Promise<string> {
  const res = await SELF.fetch('https://api.test/v1/boards', {
    method: 'POST',
    headers: headers(tenant),
    body: JSON.stringify({ name: 'Board', stages: STAGES }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { boardId: string };
  return body.boardId;
}

describe('Worker routing', () => {
  it('serves health', async () => {
    const res = await SELF.fetch('https://api.test/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, phase: 'P8' });
  });

  it('requires a tenant header on board routes', async () => {
    const res = await SELF.fetch('https://api.test/v1/boards', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
  });

  it('creates a board, a card, and moves it', async () => {
    const boardId = await createBoard();

    const created = await SELF.fetch(`https://api.test/v1/boards/${boardId}/cards`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ title: 'Ship it', ownerUserId: 'usr_a' }),
    });
    expect(created.status).toBe(201);
    const { card } = (await created.json()) as { card: { id: string; currentStageKey: string } };
    expect(card.currentStageKey).toBe('backlog');

    const moved = await SELF.fetch(`https://api.test/v1/boards/${boardId}/cards/${card.id}/move`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ toStageKey: 'doing' }),
    });
    expect(moved.status).toBe(200);

    const state = await SELF.fetch(`https://api.test/v1/boards/${boardId}`, { headers: headers() });
    const snap = (await state.json()) as { cards: { id: string; currentStageKey: string }[] };
    expect(snap.cards.find((c) => c.id === card.id)?.currentStageKey).toBe('doing');
  });

  it('maps a WIP-limit violation to 409', async () => {
    const boardId = await createBoard();
    const mk = async (title: string) =>
      (
        (await (
          await SELF.fetch(`https://api.test/v1/boards/${boardId}/cards`, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({ title, ownerUserId: 'u' }),
          })
        ).json()) as { card: { id: string } }
      ).card.id;
    const move = (id: string) =>
      SELF.fetch(`https://api.test/v1/boards/${boardId}/cards/${id}/move`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ toStageKey: 'doing' }),
      });

    const a = await mk('A');
    const b = await mk('B');
    expect((await move(a)).status).toBe(200);
    expect((await move(b)).status).toBe(409);
  });

  it('maps an unknown stage to 400', async () => {
    const boardId = await createBoard();
    const id = (
      (await (
        await SELF.fetch(`https://api.test/v1/boards/${boardId}/cards`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ title: 'A', ownerUserId: 'u' }),
        })
      ).json()) as { card: { id: string } }
    ).card.id;
    const res = await SELF.fetch(`https://api.test/v1/boards/${boardId}/cards/${id}/move`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ toStageKey: 'nope' }),
    });
    expect(res.status).toBe(400);
  });

  it('isolates boards across tenants', async () => {
    const boardId = await createBoard('tnt_a');
    // Same board id, different tenant → different DO → not found.
    const res = await SELF.fetch(`https://api.test/v1/boards/${boardId}`, { headers: headers('tnt_b') });
    expect(res.status).toBe(404);
  });

  it('streams events over the websocket', async () => {
    const boardId = await createBoard();
    const res = await SELF.fetch(`https://api.test/v1/boards/${boardId}/ws`, {
      headers: { Upgrade: 'websocket', 'X-Tenant-Id': 'tnt_a' },
    });
    expect(res.status).toBe(101);
    const ws = res.webSocket;
    expect(ws).toBeTruthy();
    ws!.accept();
    const messages: Array<{ kind: string; event?: { type: string } }> = [];
    ws!.addEventListener('message', (e: MessageEvent) => {
      messages.push(JSON.parse(e.data as string));
    });

    await SELF.fetch(`https://api.test/v1/boards/${boardId}/cards`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ title: 'Live', ownerUserId: 'u' }),
    });

    await vi.waitFor(() => {
      expect(messages.some((m) => m.kind === 'event' && m.event?.type === 'card.created')).toBe(true);
    });
    // the first message should have been the snapshot
    expect(messages[0]?.kind).toBe('snapshot');
  });
});
