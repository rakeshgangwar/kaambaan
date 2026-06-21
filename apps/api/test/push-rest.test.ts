import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

const T = { 'X-Tenant-Id': 'tnt_push', 'Content-Type': 'application/json' };
const base = 'https://api.test';

async function board(): Promise<string> {
  const b = (await (
    await SELF.fetch(`${base}/v1/boards`, {
      method: 'POST',
      headers: T,
      body: JSON.stringify({ name: 'P', stages: [{ key: 'build', name: 'Build', order: 0, ownerKind: 'capability', owner: 'build' }] }),
    })
  ).json()) as { boardId: string };
  return b.boardId;
}

describe('REST — push configs (docs/05 §4)', () => {
  it('registers a subscription and queues a delivery when matching work appears', async () => {
    const bid = await board();
    const reg = await SELF.fetch(`${base}/v1/boards/${bid}/push-configs`, {
      method: 'POST',
      headers: { ...T, 'X-Agent-Id': 'agt_b' },
      body: JSON.stringify({ url: 'https://agent.example/hook', token: 's', capabilities: ['build'], events: ['work.available'] }),
    });
    expect(reg.status).toBe(201);
    expect(((await reg.json()) as { configId: string }).configId).toMatch(/^push_/);

    await SELF.fetch(`${base}/v1/boards/${bid}/cards`, { method: 'POST', headers: T, body: JSON.stringify({ title: 'C', ownerUserId: 'usr_a' }) });

    const deliveries = ((await (await SELF.fetch(`${base}/v1/boards/${bid}/push/deliveries`, { headers: T })).json()) as { deliveries: any[] }).deliveries;
    expect(deliveries).toHaveLength(1);
    expect(JSON.parse(deliveries[0].body)).toMatchObject({ event: 'work.available', stageKey: 'build' });
  });

  it('rejects a non-http(s) url with 400', async () => {
    const bid = await board();
    const res = await SELF.fetch(`${base}/v1/boards/${bid}/push-configs`, {
      method: 'POST',
      headers: { ...T, 'X-Agent-Id': 'agt_b' },
      body: JSON.stringify({ url: 'file:///etc/passwd', token: 's' }),
    });
    expect(res.status).toBe(400);
  });

  it('requires an agent id', async () => {
    const bid = await board();
    const res = await SELF.fetch(`${base}/v1/boards/${bid}/push-configs`, {
      method: 'POST',
      headers: T,
      body: JSON.stringify({ url: 'https://x.example/h', token: 's' }),
    });
    expect(res.status).toBe(400);
  });
});
