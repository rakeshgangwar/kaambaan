import { describe, it, expect } from 'vitest';
import { Board, Card, Reference } from '../src';

describe('entity schemas', () => {
  it('parses a board with a pipeline and applies stage defaults', () => {
    const board = Board.parse({
      id: 'brd_abc123',
      tenantId: 'tnt_abc123',
      name: 'Content',
      stages: [
        { key: 'research', name: 'Research', order: 0, ownerKind: 'capability', owner: 'research' },
        { key: 'review', name: 'Review', order: 1, ownerKind: 'human', gate: 'approval' },
      ],
      createdAt: '2026-06-20T10:00:00.000Z',
    });
    expect(board.stages[0]!.gate).toBe('none'); // default
    expect(board.stages[1]!.gate).toBe('approval');
  });

  it('requires at least one stage', () => {
    const r = Board.safeParse({
      id: 'brd_abc123',
      tenantId: 'tnt_abc123',
      name: 'Empty',
      stages: [],
      createdAt: '2026-06-20T10:00:00.000Z',
    });
    expect(r.success).toBe(false);
  });

  it('applies card defaults (spec, labels, priority)', () => {
    const card = Card.parse({
      id: 'card_abc123',
      boardId: 'brd_abc123',
      tenantId: 'tnt_abc123',
      contextId: 'ctx_abc123',
      title: 'Summarize incident reports',
      ownerUserId: 'usr_abc123',
      currentStageKey: 'research',
      createdAt: '2026-06-20T10:00:00.000Z',
    });
    expect(card.spec).toEqual({});
    expect(card.labels).toEqual([]);
    expect(card.priority).toBe(0);
  });

  it('a reference requires a provider and source type', () => {
    const ok = Reference.safeParse({
      id: 'ref_abc123',
      cardId: 'card_abc123',
      tenantId: 'tnt_abc123',
      url: 'https://github.com/org/repo/pull/42',
      provider: 'github',
      sourceType: 'pull_request',
      addedBy: 'agent',
      createdAt: '2026-06-20T10:00:00.000Z',
    });
    expect(ok.success).toBe(true);
    expect(Reference.safeParse({ id: 'ref_abc123' }).success).toBe(false);
  });
});
