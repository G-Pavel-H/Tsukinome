import { describe, it, expect } from 'vitest';
import { renderCostSummary } from '../../src/pipeline/cost.js';
import type { LlmCall } from '../../src/store/types.js';

function call(over: Partial<LlmCall>): LlmCall {
  return {
    id: 1,
    runId: 1,
    role: 'triage',
    model: 'claude-haiku-4-5',
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    costNanoUsd: 0,
    ...over,
  };
}

describe('renderCostSummary', () => {
  it('handles a run with no calls', () => {
    const out = renderCostSummary([]);
    expect(out).toContain('0 model calls');
    expect(out).not.toContain('| Role |');
  });

  it('groups by role, sums tokens and cost, and totals the run', () => {
    const out = renderCostSummary([
      call({ role: 'triage', inputTokens: 100, outputTokens: 20, costNanoUsd: 120_000 }),
      call({ role: 'triage', inputTokens: 50, outputTokens: 10, costNanoUsd: 60_000 }),
      call({ role: 'review', inputTokens: 200, outputTokens: 80, costNanoUsd: 1_000_000 }),
    ]);
    // Total = 1,180,000 nano-USD = $0.001180.
    expect(out).toContain('$0.001180');
    expect(out).toContain('3 model calls');
    // triage rolled up: 150 in / 30 out across 2 calls.
    expect(out).toContain('| triage | 2 | 150/30 |');
    // review is the costliest → listed first in the table.
    const reviewIdx = out.indexOf('| review |');
    const triageIdx = out.indexOf('| triage |');
    expect(reviewIdx).toBeGreaterThan(-1);
    expect(reviewIdx).toBeLessThan(triageIdx);
  });

  it('counts cache tokens toward the input column', () => {
    const out = renderCostSummary([
      call({ role: 'review', inputTokens: 10, cacheReadTokens: 90, outputTokens: 5, costNanoUsd: 1 }),
    ]);
    expect(out).toContain('| review | 1 | 100/5 |');
  });

  // AC9: duration is rendered via formatDuration, not as a raw millisecond number
  it('renders duration via formatDuration output rather than raw milliseconds (AC9)', () => {
    // renderCostSummary accepts a durationMs parameter and renders it in the summary.
    // With 65000ms the formatted output should be "1m 5s", not "65000".
    const out = renderCostSummary(
      [call({ role: 'triage', inputTokens: 100, outputTokens: 20, costNanoUsd: 120_000 })],
      65000,
    );
    expect(out).toContain('1m 5s');
    expect(out).not.toContain('65000');
  });

  it('renders a short duration in ms format via formatDuration (AC9)', () => {
    const out = renderCostSummary(
      [call({ role: 'triage', costNanoUsd: 1 })],
      820,
    );
    expect(out).toContain('820ms');
    expect(out).not.toContain(' 820 ');
  });
});
