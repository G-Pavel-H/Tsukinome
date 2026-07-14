import { describe, it, expect } from 'vitest';
import { formatDuration } from '../../src/util/format-duration.js';

describe('formatDuration', () => {
  it('returns \'0ms\' for 0', () => {
    expect(formatDuration(0)).toBe('0ms');
  });

  it('returns \'820ms\' for 820', () => {
    expect(formatDuration(820)).toBe('820ms');
  });

  it('returns \'5s\' for 5000', () => {
    expect(formatDuration(5000)).toBe('5s');
  });

  it('returns \'1m 5s\' for 65000', () => {
    expect(formatDuration(65000)).toBe('1m 5s');
  });

  it('returns \'1h 0m\' for 3600000', () => {
    expect(formatDuration(3600000)).toBe('1h 0m');
  });

  it('returns \'0ms\' for negative number -5', () => {
    expect(formatDuration(-5)).toBe('0ms');
  });

  it('returns \'0ms\' for NaN', () => {
    expect(formatDuration(NaN)).toBe('0ms');
  });

  it('returns \'0ms\' for Infinity', () => {
    expect(formatDuration(Infinity)).toBe('0ms');
  });

  it('returns \'0ms\' for -Infinity', () => {
    expect(formatDuration(-Infinity)).toBe('0ms');
  });

  it('rounds fractional ms: 820.6 returns \'821ms\'', () => {
    expect(formatDuration(820.6)).toBe('821ms');
  });

  it('rounds up to seconds scale: 999.6 returns \'1s\'', () => {
    expect(formatDuration(999.6)).toBe('1s');
  });

  it('boundary: 1000ms returns \'1s\'', () => {
    expect(formatDuration(1000)).toBe('1s');
  });

  it('boundary: 60000ms returns \'1m 0s\'', () => {
    expect(formatDuration(60000)).toBe('1m 0s');
  });

  it('large multi-hour value: 3h 25m', () => {
    expect(formatDuration(3 * 3600000 + 25 * 60000)).toBe('3h 25m');
  });

  it('floors seconds component in minutes scale: 61500 returns \'1m 1s\'', () => {
    // 61500ms = 1 minute + 1.5 seconds → floor seconds → 1s
    expect(formatDuration(61500)).toBe('1m 1s');
  });

  it('floors minutes component in hours scale: 3661000ms returns \'1h 1m\'', () => {
    // 3661000ms = 1 hour + 1 minute + 1 second → drops seconds → 1h 1m
    expect(formatDuration(3661000)).toBe('1h 1m');
  });

  it('handles exactly one minute boundary correctly', () => {
    expect(formatDuration(59999)).toBe('59s');
  });

  it('handles exactly one hour boundary correctly', () => {
    expect(formatDuration(3599999)).toBe('59m 59s');
  });
});
