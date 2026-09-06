import { describe, it, expect } from 'vitest';
import { formatDuration } from '../src/format.js';

describe('formatDuration', () => {
  // AC1
  it('returns "0ms" for exactly 0', () => {
    expect(formatDuration(0)).toBe('0ms');
  });

  // AC2
  it('returns "820ms" for 820', () => {
    expect(formatDuration(820)).toBe('820ms');
  });

  // AC3 — round-half-up at the sub-second scale
  it('rounds sub-second fractional values to whole milliseconds (round-half-up)', () => {
    expect(formatDuration(820.6)).toBe('821ms');
  });

  // AC4 — rounding boundaries: 0.4 rounds down to 0, 0.6 rounds up to 1
  it('rounds 0.4 down to "0ms" and 0.6 up to "1ms"', () => {
    expect(formatDuration(0.4)).toBe('0ms');
    expect(formatDuration(0.6)).toBe('1ms');
  });

  // AC9 (spec AC9) — still in ms range, just under the 1000ms boundary
  it('returns "999ms" for 999 (just under the second boundary)', () => {
    expect(formatDuration(999)).toBe('999ms');
  });

  // AC4 (spec AC4) — exact second
  it('returns "5s" for 5000', () => {
    expect(formatDuration(5000)).toBe('5s');
  });

  // AC10 (spec AC10) — sub-second remainder dropped at the seconds scale
  it('drops sub-second remainder at the seconds scale (5900 → "5s")', () => {
    expect(formatDuration(5900)).toBe('5s');
  });

  // AC8 (spec) — boundary between seconds and minutes
  it('handles the seconds/minutes boundary: 59999 → "59s", 60000 → "1m 0s"', () => {
    expect(formatDuration(59999)).toBe('59s');
    expect(formatDuration(60000)).toBe('1m 0s');
  });

  // AC5 (spec)
  it('returns "1m 5s" for 65000', () => {
    expect(formatDuration(65000)).toBe('1m 5s');
  });

  // boundary between minutes and hours
  it('handles the minutes/hours boundary: 3599999 → "59m 59s", 3600000 → "1h 0m"', () => {
    expect(formatDuration(3599999)).toBe('59m 59s');
    expect(formatDuration(3600000)).toBe('1h 0m');
  });

  // AC6 (spec)
  it('returns "1h 0m" for 3600000', () => {
    expect(formatDuration(3600000)).toBe('1h 0m');
  });

  // AC7 (spec) — negative values
  it('returns "0ms" for negative values including negative zero', () => {
    expect(formatDuration(-5)).toBe('0ms');
    expect(formatDuration(-0)).toBe('0ms');
  });

  // AC8 (spec) — non-finite values
  it('returns "0ms" for NaN', () => {
    expect(formatDuration(NaN)).toBe('0ms');
  });

  it('returns "0ms" for Infinity', () => {
    expect(formatDuration(Infinity)).toBe('0ms');
  });

  it('returns "0ms" for -Infinity', () => {
    expect(formatDuration(-Infinity)).toBe('0ms');
  });

  // extra boundary: multi-hour value
  it('handles a multi-hour value correctly', () => {
    // 2h 30m = 9000000ms
    expect(formatDuration(9_000_000)).toBe('2h 30m');
  });
});
