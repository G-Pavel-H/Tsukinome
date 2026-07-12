import { describe, it, expect } from 'vitest';
import { formatDuration } from '../../src/utils/formatDuration';

describe('formatDuration', () => {
  // AC1: 0 -> "0ms"
  it('returns "0ms" for 0', () => {
    expect(formatDuration(0)).toBe('0ms');
  });

  // AC13: negative -> "0ms"
  it('returns "0ms" for -100', () => {
    expect(formatDuration(-100)).toBe('0ms');
  });

  // AC14: NaN -> "0ms"
  it('returns "0ms" for NaN', () => {
    expect(formatDuration(NaN)).toBe('0ms');
  });

  // AC15: Infinity -> "0ms"
  it('returns "0ms" for Infinity', () => {
    expect(formatDuration(Infinity)).toBe('0ms');
  });

  // AC16: -Infinity -> "0ms"
  it('returns "0ms" for -Infinity', () => {
    expect(formatDuration(-Infinity)).toBe('0ms');
  });

  // AC17: -0 -> "0ms"
  it('returns "0ms" for -0', () => {
    expect(formatDuration(-0)).toBe('0ms');
  });

  // AC2: 820 -> "820ms"
  it('returns "820ms" for 820', () => {
    expect(formatDuration(820)).toBe('820ms');
  });

  // AC3: 820.6 -> "821ms" (nearest-integer rounding)
  it('returns "821ms" for 820.6', () => {
    expect(formatDuration(820.6)).toBe('821ms');
  });

  // AC4: 999 -> "999ms"
  it('returns "999ms" for 999', () => {
    expect(formatDuration(999)).toBe('999ms');
  });

  // AC5: 1000 -> "1s" (boundary)
  it('returns "1s" for 1000', () => {
    expect(formatDuration(1000)).toBe('1s');
  });

  // AC6: 5000 -> "5s"
  it('returns "5s" for 5000', () => {
    expect(formatDuration(5000)).toBe('5s');
  });

  // AC7: 59999 -> "1m 0s" (carry from seconds rounding)
  it('returns "1m 0s" for 59999', () => {
    expect(formatDuration(59999)).toBe('1m 0s');
  });

  // AC8: 60000 -> "1m 0s" (boundary)
  it('returns "1m 0s" for 60000', () => {
    expect(formatDuration(60000)).toBe('1m 0s');
  });

  // AC9: 65000 -> "1m 5s"
  it('returns "1m 5s" for 65000', () => {
    expect(formatDuration(65000)).toBe('1m 5s');
  });

  // AC10: 65999 -> "1m 6s" (second rounding)
  it('returns "1m 6s" for 65999', () => {
    expect(formatDuration(65999)).toBe('1m 6s');
  });

  // AC11: 3599999 -> "1h 0m" (carry to hour)
  it('returns "1h 0m" for 3599999', () => {
    expect(formatDuration(3599999)).toBe('1h 0m');
  });

  // AC12: 3600000 -> "1h 0m" (boundary)
  it('returns "1h 0m" for 3600000', () => {
    expect(formatDuration(3600000)).toBe('1h 0m');
  });

  // Sanity: very large value (2h 30m)
  it('returns "2h 30m" for 9000000', () => {
    expect(formatDuration(9000000)).toBe('2h 30m');
  });

  // Verify the variable formerly named `s` is now named `seconds`
  // (the source must use `seconds` not `s` — confirmed by reading the implementation)
  it('uses a variable named "seconds" in the implementation (rename from s)', () => {
    // This test checks that the implementation source contains the identifier `seconds`
    // and does NOT contain a bare `const s =` declaration.
    // We read the source at import time indirectly by asserting behavioural correctness
    // AND we verify the source text via a static assertion embedded here.
    const src = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../src/utils/formatDuration.ts'),
      'utf8'
    );
    // Must contain the renamed variable
    expect(src).toMatch(/\bseconds\b/);
    // Must NOT contain the old short variable `const s =`
    expect(src).not.toMatch(/\bconst s\s*=/);
  });
});
