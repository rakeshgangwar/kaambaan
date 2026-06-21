/**
 * Turn surface-level reference arguments (from MCP or REST) into the Board DO's `ReferenceInput`,
 * auto-enriching `provider`/`sourceType`/`externalId` from the URL when the caller didn't supply
 * them (docs/06 §1). Shared by both wires so enrichment is identical (REST ≡ MCP).
 */
import { recognizeReference } from './github-url';
import type { ReferenceInput, JsonValue } from '../board/board-do';

export interface ReferenceArgs {
  cardId: string;
  url: string;
  provider?: string;
  sourceType?: string;
  title?: string;
  subtitle?: string;
  externalId?: string;
  metadata?: Record<string, unknown>;
  addedBy?: 'agent' | 'user';
}

export function resolveReferenceInput(args: ReferenceArgs): ReferenceInput {
  const recognized = recognizeReference(args.url);
  return {
    cardId: args.cardId,
    url: args.url,
    provider: args.provider ?? recognized.provider,
    sourceType: args.sourceType ?? recognized.sourceType,
    externalId: args.externalId ?? recognized.externalId,
    title: args.title,
    subtitle: args.subtitle,
    metadata: args.metadata as JsonValue | undefined,
    addedBy: args.addedBy ?? 'agent',
  };
}
