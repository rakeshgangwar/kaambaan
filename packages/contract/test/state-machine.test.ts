import { describe, it, expect } from 'vitest';
import {
  nextState,
  canTransition,
  deriveStateFromActivity,
  IllegalTransitionError,
  TERMINAL_STATES,
  isTerminal,
  type TaskState,
  type TaskEventType,
} from '../src';

// Each row mirrors the normative transition table in docs/03-card-lifecycle.md.
const LEGAL: ReadonlyArray<[TaskState, TaskEventType, TaskState]> = [
  ['submitted', 'claim', 'working'],
  ['submitted', 'cancel', 'canceled'],
  ['working', 'progress', 'working'],
  ['working', 'response', 'completed'],
  ['working', 'error', 'failed'],
  ['working', 'request_input', 'input-required'],
  ['working', 'auth_required', 'auth-required'],
  ['working', 'submit_for_review', 'input-required'],
  ['working', 'heartbeat_timeout', 'submitted'],
  ['working', 'cancel', 'canceled'],
  ['input-required', 'gate_approve', 'completed'],
  ['input-required', 'gate_request_changes', 'working'],
  ['input-required', 'gate_reject', 'rejected'],
  ['input-required', 'human_reply', 'working'],
  ['input-required', 'cancel', 'canceled'],
  ['auth-required', 'account_linked', 'working'],
  ['auth-required', 'cancel', 'canceled'],
];

describe('task state machine — legal transitions', () => {
  it.each(LEGAL)('%s --%s--> %s', (from, event, to) => {
    expect(nextState(from, event)).toBe(to);
    expect(canTransition(from, event)).toBe(true);
  });
});

describe('task state machine — terminal immutability', () => {
  const ALL_EVENTS: TaskEventType[] = [
    'claim',
    'progress',
    'response',
    'error',
    'request_input',
    'auth_required',
    'submit_for_review',
    'heartbeat_timeout',
    'cancel',
    'gate_approve',
    'gate_request_changes',
    'gate_reject',
    'human_reply',
    'account_linked',
  ];

  it.each(TERMINAL_STATES)('no event transitions out of terminal "%s"', (state) => {
    expect(isTerminal(state)).toBe(true);
    for (const event of ALL_EVENTS) {
      expect(canTransition(state, event)).toBe(false);
      expect(() => nextState(state, event)).toThrow(IllegalTransitionError);
    }
  });
});

describe('task state machine — illegal transitions throw', () => {
  it('cannot claim a task that is already working', () => {
    expect(() => nextState('working', 'claim')).toThrow(IllegalTransitionError);
  });
  it('cannot approve a gate on a task that is still working', () => {
    expect(() => nextState('working', 'gate_approve')).toThrow(IllegalTransitionError);
  });
  it('exposes from/event on the error', () => {
    try {
      nextState('submitted', 'response');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalTransitionError);
      expect((err as IllegalTransitionError).from).toBe('submitted');
      expect((err as IllegalTransitionError).event).toBe('response');
    }
  });
});

describe('deriveStateFromActivity', () => {
  it('response -> completed', () => expect(deriveStateFromActivity('response')).toBe('completed'));
  it('error -> failed', () => expect(deriveStateFromActivity('error')).toBe('failed'));
  it('elicitation -> input-required', () =>
    expect(deriveStateFromActivity('elicitation')).toBe('input-required'));
  it('elicitation + auth signal -> auth-required', () =>
    expect(deriveStateFromActivity('elicitation', 'auth')).toBe('auth-required'));
  it('prompt -> working', () => expect(deriveStateFromActivity('prompt')).toBe('working'));
  it('thought/action -> null (no state change)', () => {
    expect(deriveStateFromActivity('thought')).toBeNull();
    expect(deriveStateFromActivity('action')).toBeNull();
  });
});
