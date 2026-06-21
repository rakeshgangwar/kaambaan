import { describe, it, expect } from 'vitest';
import { depsFor, connectMcp, initBoard, toolJson, RESEARCH_PIPELINE } from './helpers/mcp';
import type { McpAuth } from '../src/mcp/tools';

const AUTH: McpAuth = { tenantId: 'tnt_lw', agentId: 'agt_lw', capabilities: ['research'] };

describe('MCP — kaambaan_list_work (work discovery)', () => {
  it('lists the workspace boards with the count of cards ready for my capabilities', async () => {
    const stub = await initBoard(AUTH, 'brd_lw', RESEARCH_PIPELINE, 'Launch');
    await stub.createCard({ title: 'A', ownerUserId: 'usr_a' });
    await stub.createCard({ title: 'B', ownerUserId: 'usr_a' });

    const client = await connectMcp(depsFor(AUTH, [{ id: 'brd_lw', name: 'Launch' }]));
    const result = toolJson(await client.callTool({ name: 'kaambaan_list_work', arguments: {} })) as {
      capabilities: string[];
      boards: Array<{ boardId: string; name: string; readyForYou: number }>;
    };

    expect(result.capabilities).toEqual(['research']);
    expect(result.boards).toEqual([{ boardId: 'brd_lw', name: 'Launch', readyForYou: 2 }]);
  });
});
