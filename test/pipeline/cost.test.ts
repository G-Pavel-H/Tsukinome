import { describe, it, expect } from 'vitest';
import { renderCostSummary } from '../../src/pipeline/cost.js';
import type { LlmCall } from '../../src/store/types.js';

function makeCall(overrides: Partial<LlmCall> = {}): LlmCall {
  return {
    id: 'call-1',
    runId: 'run-1',
    role: 'implementer',
    model: 'claude-3-5-haiku-20241022',
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
  it('returns a headline for an empty call list', () => {
    const result = renderCostSummary([]);
    expect(result).toContain('0 model calls');
  });

  it('renders a per-role breakdown for non-empty call list', () => {
    const calls = [makeCall()];
    const result = renderCostSummary(calls);
    expect(result).toContain('implementer');
  });

  it('uses singular "call" for exactly one call', () => {
    const result = renderCostSummary([makeCall()]);
    expect(result).toMatch(/1 model call[^s]/);
  });

  it('uses plural "calls" for multiple calls', () => {
    const result = renderCostSummary([makeCall(), makeCall({ id: 'call-2', role: 'reviewer' })]);
    expect(result).toContain('2 model calls');
  });

  describe('duration display (AC10)', () => {
    it('renders 65000ms duration as "1m 5s" in the summary', () => {
      const calls = [makeCall({ durationMs: 65000 })];
      const result = renderCostSummary(calls, 65000);
      expect(result).toContain('1m 5s');
    });

    it('does not contain raw "65000" ms number in summary when duration is 65000ms', () => {
      const calls = [makeCall({ durationMs: 65000 })];
      const result = renderCostSummary(calls, 65000);
      expect(result).not.toContain('65000');
    });

    it('renders 5000ms duration as "5s" in the summary', () => {
      const calls = [makeCall({ durationMs: 5000 })];
      const result = renderCostSummary(calls, 5000);
      expect(result).toContain('5s');
    });

    it('renders 3600000ms duration as "1h 0m" in the summary', () => {
      const calls = [makeCall()];
      const result = renderCostSummary(calls, 3600000);
      expect(result).toContain('1h 0m');
    });

    it('does not contain raw "3600000" in summary when duration is 3600000ms', () => {
      const calls = [makeCall()];
      const result = renderCostSummary(calls, 3600000);
      expect(result).not.toContain('3600000');
    });

    it('omits duration line when no duration is provided', () => {
      const calls = [makeCall()];
      const result = renderCostSummary(calls);
      // should not contain a duration/time label when duration arg is absent
      expect(result).not.toMatch(/\d+ms|\d+s|\d+m \d+s|\d+h \d+m/);
    });
  });
});
