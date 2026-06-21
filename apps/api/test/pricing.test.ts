import { describe, it, expect } from 'vitest';
import { estimateCostUsd, isModelPriced } from '../src/metering/pricing';

/** docs/07 §6: cost is estimated from tokens × model pricing when the agent doesn't report it. */
describe('estimateCostUsd', () => {
  it('prices input and output tokens per million (Sonnet 4.6: $3 in / $15 out)', () => {
    // 2M input + 1M output = 2*3 + 1*15 = 21
    expect(estimateCostUsd({ model: 'claude-sonnet-4-6', inputTokens: 2_000_000, outputTokens: 1_000_000 })).toBeCloseTo(21, 6);
  });

  it('prices the flagship and the cheap tier distinctly', () => {
    const opus = estimateCostUsd({ model: 'claude-opus-4-8', inputTokens: 1_000_000, outputTokens: 0 });
    const haiku = estimateCostUsd({ model: 'claude-haiku-4-5', inputTokens: 1_000_000, outputTokens: 0 });
    expect(opus).toBeGreaterThan(haiku);
  });

  it('scales linearly with token counts', () => {
    const half = estimateCostUsd({ model: 'claude-opus-4-8', inputTokens: 500_000, outputTokens: 250_000 });
    const full = estimateCostUsd({ model: 'claude-opus-4-8', inputTokens: 1_000_000, outputTokens: 500_000 });
    expect(full).toBeCloseTo(half * 2, 6);
  });

  it('returns 0 for an unknown / unpriced model (and reports it unpriced)', () => {
    expect(estimateCostUsd({ model: 'mystery-model', inputTokens: 1000, outputTokens: 1000 })).toBe(0);
    expect(isModelPriced('mystery-model')).toBe(false);
    expect(isModelPriced('claude-opus-4-8')).toBe(true);
  });

  it('treats a missing model as unpriced', () => {
    expect(estimateCostUsd({ inputTokens: 1000, outputTokens: 1000 })).toBe(0);
  });
});
