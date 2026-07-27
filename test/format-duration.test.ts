import { describe, it, expect } from 'vitest';
import { formatDuration } from '../src/format-duration.js';

describe('formatDuration', () => {
  it('AC1: returns "0ms" for 0', () => {
    expect(formatDuration(0)).toBe('0ms');
  });

  it('AC2: returns "820ms" for 820', () => {
    expect(formatDuration(820)).toBe('820ms');
  });

  it('AC6: returns "821ms" for 820.6 (rounded)', () => {
    expect(formatDuration(820.6)).toBe('821ms');
  });

  it('rounds 0.4 down to 0 and returns "0ms"', () => {
    expect(formatDuration(0.4)).toBe('0ms');
  });

  it('AC3: returns "5s" for 5000', () => {
    expect(formatDuration(5000)).toBe('5s');
  });

  it('floors to seconds: 5999 -> "5s"', () => {
    expect(formatDuration(5999)).toBe('5s');
  });

  it('boundary 1000ms -> "1s"', () => {
    expect(formatDuration(1000)).toBe('1s');
  });

  it('AC4: returns "1m 5s" for 65000', () => {
    expect(formatDuration(65000)).toBe('1m 5s');
  });

  it('boundary 60000ms -> "1m 0s"', () => {
    expect(formatDuration(60000)).toBe('1m 0s');
  });

  it('AC5: returns "1h 0m" for 3600000', () => {
    expect(formatDuration(3600000)).toBe('1h 0m');
  });

  it('returns "2h 3m" for 7380000', () => {
    expect(formatDuration(7380000)).toBe('2h 3m');
  });

  it('AC7: returns "0ms" for -5', () => {
    expect(formatDuration(-5)).toBe('0ms');
  });

  it('returns "0ms" for -0', () => {
    expect(formatDuration(-0)).toBe('0ms');
  });

  it('AC8: returns "0ms" for NaN', () => {
    expect(formatDuration(NaN)).toBe('0ms');
  });

  it('AC8: returns "0ms" for Infinity', () => {
    expect(formatDuration(Infinity)).toBe('0ms');
  });

  it('AC8: returns "0ms" for -Infinity', () => {
    expect(formatDuration(-Infinity)).toBe('0ms');
  });

  it('renders components as integers without leading zeros (65000 -> "1m 5s", not "1m 05s")', () => {
    const result = formatDuration(65000);
    expect(result).toBe('1m 5s');
    expect(result).not.toContain('05s');
  });

  it('renders seconds component without leading zero in minute range', () => {
    // 61000ms = 1m 1s, not 1m 01s
    expect(formatDuration(61000)).toBe('1m 1s');
  });

  it('renders minutes component without leading zero in hour range', () => {
    // 3660000ms = 1h 1m, not 1h 01m
    expect(formatDuration(3660000)).toBe('1h 1m');
  });
});
