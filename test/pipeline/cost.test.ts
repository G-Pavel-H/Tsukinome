import { describe, it, expect } from 'vitest';
import { renderCostSummary } from '../../src/pipeline/cost.js';
import type { LlmCall } from '../../src/store/types.js';

function makeCall(overrides: Partial<LlmCall> = {}): LlmCall {
  return {
    id: 'test-id',
    runId: 'run-1',
    role: 'test-role',
    model: 'test-model',
    inputTokens: 100,
    outputTokens: 50,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    costNanoUsd: 1_000_000,
    durationMs: 0,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('renderCostSummary', () => {
  it('renders a headline with no calls', () => {
    const result = renderCostSummary([]);
    expect(result).toContain('Run cost');
    expect(result).toContain('0 model calls');
  });

  it('renders per-role table when calls are present', () => {
    const calls = [makeCall({ role: 'implementer' })];
    const result = renderCostSummary(calls);
    expect(result).toContain('implementer');
    expect(result).toContain('Role');
  });

  it('AC9: displays duration using formatDuration output (e.g. "1m 5s") rather than raw ms (65000)', () => {
    // A run with durationMs = 65000 should show "1m 5s" not "65000"
    const calls = [makeCall({ durationMs: 65000 })];
    const result = renderCostSummary(calls, 65000);
    expect(result).toContain('1m 5s');
    expect(result).not.toContain('65000');
  });

  it('AC9: displays duration using formatDuration output (e.g. "5s") for a 5000ms run', () => {
    const calls = [makeCall({ durationMs: 5000 })];
    const result = renderCostSummary(calls, 5000);
    expect(result).toContain('5s');
    expect(result).not.toContain('5000ms');
    expect(result).not.toMatch(/\b5000\b/);
  });

  it('AC9: displays "0ms" when duration is 0', () => {
    const calls = [makeCall({ durationMs: 0 })];
    const result = renderCostSummary(calls, 0);
    expect(result).toContain('0ms');
  });
});
