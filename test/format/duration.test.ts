import { describe, it, expect } from 'vitest';
import { formatDuration } from '../../src/format/duration.js';

describe('formatDuration', () => {
  // AC1 / R7: zero input
  it('returns "0ms" for 0', () => {
    expect(formatDuration(0)).toBe('0ms');
  });

  // AC2 / R2: sub-second whole value
  it('returns "820ms" for 820', () => {
    expect(formatDuration(820)).toBe('820ms');
  });

  // AC6 / R6: sub-second fractional value rounds to whole ms
  it('returns "821ms" for 820.6 (rounds up)', () => {
    expect(formatDuration(820.6)).toBe('821ms');
  });

  // AC3 / R3: exactly one second
  it('returns "1s" for 1000', () => {
    expect(formatDuration(1000)).toBe('1s');
  });

  // AC3 / R3: several seconds, no minutes
  it('returns "5s" for 5000', () => {
    expect(formatDuration(5000)).toBe('5s');
  });

  // R12 edge: 59999ms rounds to 60s which carries into 1m 0s
  it('returns "1m 0s" for 59999 (carry normalization)', () => {
    expect(formatDuration(59999)).toBe('1m 0s');
  });

  // AC4 / R4: minute scale with non-zero seconds
  it('returns "1m 5s" for 65000', () => {
    expect(formatDuration(65000)).toBe('1m 5s');
  });

  // R13: minute scale always shows seconds even when zero
  it('returns "1m 0s" for 60000', () => {
    expect(formatDuration(60000)).toBe('1m 0s');
  });

  // AC5 / R5: exactly one hour
  it('returns "1h 0m" for 3600000', () => {
    expect(formatDuration(3600000)).toBe('1h 0m');
  });

  // R13: hour scale always shows minutes even when zero (same as AC5)
  it('returns "1h 0m" for 3600000 (minutes always shown at hour scale)', () => {
    expect(formatDuration(3600000)).toBe('1h 0m');
  });

  // Large duration spanning multiple hours and non-zero minutes
  it('returns "2h 5m" for 7500000', () => {
    expect(formatDuration(7500000)).toBe('2h 5m');
  });

  // AC7 / R8: negative input
  it('returns "0ms" for -100', () => {
    expect(formatDuration(-100)).toBe('0ms');
  });

  // AC8 / R8: NaN
  it('returns "0ms" for NaN', () => {
    expect(formatDuration(NaN)).toBe('0ms');
  });

  // AC8 / R8: positive Infinity
  it('returns "0ms" for Infinity', () => {
    expect(formatDuration(Infinity)).toBe('0ms');
  });

  // AC8 / R8: negative Infinity
  it('returns "0ms" for -Infinity', () => {
    expect(formatDuration(-Infinity)).toBe('0ms');
  });

  // Additional edge: sub-second value just below 1s
  it('returns "999ms" for 999', () => {
    expect(formatDuration(999)).toBe('999ms');
  });

  // Additional edge: value that rounds down at second boundary
  it('returns "1s" for 1499 (rounds to nearest second → 1s)', () => {
    expect(formatDuration(1499)).toBe('1s');
  });

  // Additional edge: value that rounds up to next second
  it('returns "2s" for 1500 (rounds to nearest second → 2s)', () => {
    expect(formatDuration(1500)).toBe('2s');
  });

  // Additional edge: large hour count
  it('returns "10h 0m" for 36000000 (10 hours)', () => {
    expect(formatDuration(36000000)).toBe('10h 0m');
  });
});
