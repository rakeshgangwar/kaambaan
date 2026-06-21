/**
 * Model pricing for cost estimation (docs/07 §6). When an agent reports `costUsd` we use it; when it
 * doesn't, we estimate from tokens × these rates. Rates are USD per **million** tokens and are a
 * starting table — pricing is an ⚠️ OPEN item, so this is intentionally easy to edit (and could move
 * to tenant config later). Unknown models price to 0 and are flagged `unpriced`.
 */
export interface ModelPrice {
  inputPerMtok: number;
  outputPerMtok: number;
}

export const PRICING: Record<string, ModelPrice> = {
  'claude-opus-4-8': { inputPerMtok: 15, outputPerMtok: 75 },
  'claude-sonnet-4-6': { inputPerMtok: 3, outputPerMtok: 15 },
  'claude-haiku-4-5': { inputPerMtok: 0.8, outputPerMtok: 4 },
  'claude-fable-5': { inputPerMtok: 5, outputPerMtok: 25 },
  'gpt-5': { inputPerMtok: 10, outputPerMtok: 30 },
};

export function isModelPriced(model: string | undefined): boolean {
  return model !== undefined && model in PRICING;
}

export function estimateCostUsd(input: { model?: string; inputTokens?: number; outputTokens?: number }): number {
  const price = input.model ? PRICING[input.model] : undefined;
  if (!price) return 0;
  const inputCost = ((input.inputTokens ?? 0) / 1_000_000) * price.inputPerMtok;
  const outputCost = ((input.outputTokens ?? 0) / 1_000_000) * price.outputPerMtok;
  return inputCost + outputCost;
}
