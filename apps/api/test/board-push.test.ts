import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BoardDO, type BoardInit } from '../src/board/board-do';

const BUILD: BoardInit['stages'] = [{ key: 'build', name: 'Build', order: 0, ownerKind: 'capability', owner: 'build' }];

function stubFor(name: string): DurableObjectStub<BoardDO> {
  return env.BOARD_DO.get(env.BOARD_DO.idFromName(name)) as unknown as DurableObjectStub<BoardDO>;
}

const HOOK = 'https://agent.example/hook';

describe('BoardDO — outbound push (docs/05 §4)', () => {
  it('queues a work.available delivery when a matching card becomes claimable', async () => {
    await runInDurableObject(stubFor('p-queue'), async (board: BoardDO) => {
      await board.init({ id: 'brd_p', tenantId: 'tnt_a', name: 'P', stages: BUILD });
      const reg = await board.registerPushConfig({ agentId: 'agt_b', url: HOOK, token: 's3cret', capabilities: ['build'], events: ['work.available'] });
      expect(reg.ok).toBe(true);

      await board.createCard({ title: 'Build it', ownerUserId: 'usr_a' }); // enters 'build' submitted → claimable

      const deliveries = await board.getPushDeliveries();
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]!.url).toBe(HOOK);
      expect(deliveries[0]!.status).toBe('pending');
      expect(JSON.parse(deliveries[0]!.body)).toMatchObject({ event: 'work.available', stageKey: 'build' });
    });
  });

  it('does not notify an agent whose capabilities do not match the stage', async () => {
    await runInDurableObject(stubFor('p-nomatch'), async (board: BoardDO) => {
      await board.init({ id: 'brd_pn', tenantId: 'tnt_a', name: 'PN', stages: BUILD });
      await board.registerPushConfig({ agentId: 'agt_x', url: HOOK, token: 's', capabilities: ['publish'], events: ['work.available'] });
      await board.createCard({ title: 'Build it', ownerUserId: 'usr_a' });
      expect(await board.getPushDeliveries()).toHaveLength(0);
    });
  });

  it('rejects a non-http(s) push url (SSRF guard)', async () => {
    await runInDurableObject(stubFor('p-ssrf'), async (board: BoardDO) => {
      await board.init({ id: 'brd_ps', tenantId: 'tnt_a', name: 'PS', stages: BUILD });
      const r = await board.registerPushConfig({ agentId: 'a', url: 'file:///etc/passwd', token: 's' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('INVALID_URL');
    });
  });

  it('dispatches pending deliveries via the sender and marks them sent', async () => {
    await runInDurableObject(stubFor('p-dispatch'), async (board: BoardDO) => {
      await board.init({ id: 'brd_pd', tenantId: 'tnt_a', name: 'PD', stages: BUILD });
      await board.registerPushConfig({ agentId: 'agt_b', url: HOOK, token: 's3cret', capabilities: ['build'], events: ['work.available'] });
      await board.createCard({ title: 'Build it', ownerUserId: 'usr_a' });

      const sent: string[] = [];
      const result = await board.dispatchPushDeliveries(async (url) => {
        sent.push(url);
        return { status: 200 };
      });
      expect(result).toEqual({ sent: 1, failed: 0 });
      expect(sent).toEqual([HOOK]);
      expect((await board.getPushDeliveries())[0]!.status).toBe('sent');
    });
  });

  it('marks a failed delivery and counts it', async () => {
    await runInDurableObject(stubFor('p-failed'), async (board: BoardDO) => {
      await board.init({ id: 'brd_pf', tenantId: 'tnt_a', name: 'PF', stages: BUILD });
      await board.registerPushConfig({ agentId: 'agt_b', url: HOOK, token: 's', capabilities: ['build'], events: ['work.available'] });
      await board.createCard({ title: 'Build it', ownerUserId: 'usr_a' });
      const result = await board.dispatchPushDeliveries(async () => ({ status: 503 }));
      expect(result).toEqual({ sent: 0, failed: 1 });
      expect((await board.getPushDeliveries())[0]!.status).toBe('failed');
    });
  });
});
