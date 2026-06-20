import { describe, it, expect } from 'vitest';
import { ActivityEnvelope } from '../src';

const base = {
  runId: 'run_abc123',
  seq: 0,
  ts: '2026-06-20T10:00:00.000Z',
};

describe('ActivityEnvelope invariants (docs/04 §4)', () => {
  it('accepts a valid ephemeral thought', () => {
    const r = ActivityEnvelope.safeParse({ ...base, type: 'thought', ephemeral: true, body: 'thinking' });
    expect(r.success).toBe(true);
  });

  it('accepts a valid action with an action name', () => {
    const r = ActivityEnvelope.safeParse({ ...base, type: 'action', action: 'web.fetch', ephemeral: true });
    expect(r.success).toBe(true);
  });

  it('rejects an ephemeral response (only thought/action may be ephemeral)', () => {
    const r = ActivityEnvelope.safeParse({ ...base, type: 'response', ephemeral: true, body: 'done' });
    expect(r.success).toBe(false);
  });

  it('rejects an action without an action field', () => {
    const r = ActivityEnvelope.safeParse({ ...base, type: 'action' });
    expect(r.success).toBe(false);
  });

  it('rejects a response without a body', () => {
    const r = ActivityEnvelope.safeParse({ ...base, type: 'response' });
    expect(r.success).toBe(false);
  });

  it('defaults ephemeral to false', () => {
    const r = ActivityEnvelope.parse({ ...base, type: 'response', body: 'ok' });
    expect(r.ephemeral).toBe(false);
  });

  it('rejects a malformed runId', () => {
    const r = ActivityEnvelope.safeParse({ ...base, runId: 'nope', type: 'thought', body: 'x' });
    expect(r.success).toBe(false);
  });
});
