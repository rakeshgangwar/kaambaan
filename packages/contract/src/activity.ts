import { z } from 'zod';
import { ActivityType, ActivityKind, Signal } from './primitives';
import { RunId } from './ids';

/** Token/cost accounting carried on an activity (docs/07 §6). */
export const Usage = z.object({
  inputTokens: z.number().int().min(0).optional(),
  outputTokens: z.number().int().min(0).optional(),
  model: z.string().optional(),
  costUsd: z.number().min(0).optional(),
});
export type Usage = z.infer<typeof Usage>;

const ActivityFields = z.object({
  runId: RunId,
  seq: z.number().int().min(0),
  ts: z.string(),
  type: ActivityType,
  kind: ActivityKind.optional(),
  ephemeral: z.boolean().default(false),
  body: z.string().optional(),
  action: z.string().optional(),
  parameter: z.unknown().optional(),
  result: z.unknown().optional(),
  signal: Signal.optional(),
  signalMetadata: z.record(z.string(), z.unknown()).optional(),
  usage: Usage.optional(),
  idempotencyKey: z.string().optional(),
});

const MESSAGE_REQUIRED: readonly string[] = ['response', 'elicitation', 'error', 'prompt'];

/**
 * The normalized activity envelope — the single typed shape every harness reports in, so the
 * board stays domain-agnostic (docs/05 §1). Invariants (docs/04 §4):
 *  - only `thought`/`action` may be ephemeral;
 *  - `action` activities must name an `action`;
 *  - message-bearing activities (`response`/`elicitation`/`error`/`prompt`) must carry a `body`.
 */
export const ActivityEnvelope = ActivityFields.refine(
  (a) => !(a.ephemeral && a.type !== 'thought' && a.type !== 'action'),
  { message: 'ephemeral is only allowed for thought/action activities', path: ['ephemeral'] },
)
  .refine((a) => !(a.type === 'action' && !a.action), {
    message: 'action activities require an "action" field',
    path: ['action'],
  })
  .refine((a) => !(MESSAGE_REQUIRED.includes(a.type) && !a.body), {
    message: 'response/elicitation/error/prompt activities require a "body"',
    path: ['body'],
  });
export type ActivityEnvelope = z.infer<typeof ActivityEnvelope>;
