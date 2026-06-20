import type { TaskState, ActivityType, SignalType } from './primitives';

/**
 * The card/task state machine. This is the executable encoding of the normative transition
 * table in docs/03-card-lifecycle.md — every entry here corresponds to a row there and to a
 * test in packages/contract/test/state-machine.test.ts.
 */
export type TaskEventType =
  | 'claim' // submitted -> working
  | 'progress' // working -> working (thought/action; no state change)
  | 'response' // working -> completed
  | 'error' // working -> failed
  | 'request_input' // working -> input-required (clarification)
  | 'auth_required' // working -> auth-required
  | 'submit_for_review' // working -> input-required (gate)
  | 'heartbeat_timeout' // working -> submitted (reclaim)
  | 'cancel' // * -> canceled
  | 'gate_approve' // input-required -> completed (orchestration then creates the next stage's task)
  | 'gate_request_changes' // input-required -> working
  | 'gate_reject' // input-required -> rejected
  | 'human_reply' // input-required -> working (answer to a question)
  | 'account_linked'; // auth-required -> working

export class IllegalTransitionError extends Error {
  readonly from: TaskState;
  readonly event: TaskEventType;
  constructor(from: TaskState, event: TaskEventType) {
    super(`illegal transition: "${event}" is not allowed from "${from}"`);
    this.name = 'IllegalTransitionError';
    this.from = from;
    this.event = event;
  }
}

const TRANSITIONS: Record<TaskState, Partial<Record<TaskEventType, TaskState>>> = {
  submitted: {
    claim: 'working',
    cancel: 'canceled',
  },
  working: {
    progress: 'working',
    response: 'completed',
    error: 'failed',
    request_input: 'input-required',
    auth_required: 'auth-required',
    submit_for_review: 'input-required',
    heartbeat_timeout: 'submitted',
    cancel: 'canceled',
  },
  'input-required': {
    gate_approve: 'completed',
    gate_request_changes: 'working',
    gate_reject: 'rejected',
    human_reply: 'working',
    cancel: 'canceled',
  },
  'auth-required': {
    account_linked: 'working',
    cancel: 'canceled',
  },
  // Terminal states never transition — rework creates a NEW task under the same contextId.
  completed: {},
  rejected: {},
  failed: {},
  canceled: {},
};

/** Whether `event` is a legal transition out of `from`. */
export function canTransition(from: TaskState, event: TaskEventType): boolean {
  return TRANSITIONS[from][event] !== undefined;
}

/** Apply `event` to `from`, returning the next state. Throws `IllegalTransitionError` if illegal. */
export function nextState(from: TaskState, event: TaskEventType): TaskState {
  const to = TRANSITIONS[from][event];
  if (to === undefined) throw new IllegalTransitionError(from, event);
  return to;
}

/**
 * The state a (non-ephemeral) activity drives the task to, or `null` for no change.
 * State is DERIVED from the activity stream — agents never set it directly (docs/04 §4, Principle 4).
 */
export function deriveStateFromActivity(
  type: ActivityType,
  signal?: SignalType,
): TaskState | null {
  switch (type) {
    case 'response':
      return 'completed';
    case 'error':
      return 'failed';
    case 'elicitation':
      return signal === 'auth' ? 'auth-required' : 'input-required';
    case 'prompt':
      return 'working';
    case 'thought':
    case 'action':
      return null;
  }
}
