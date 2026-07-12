import { describe, it, expect } from 'vitest';
import { formatDuration } from '../../src/utils/formatDuration';

describe('formatDuration', () => {
  describe('non-positive and non-finite inputs return "0ms"', () => {
    it('AC1: returns "0ms" for 0', () => {
      expect(formatDuration(0)).toBe('0ms');
    });

    it('AC13: returns "0ms" for -100', () => {
      expect(formatDuration(-100)).toBe('0ms');
    });

    it('AC14: returns "0ms" for NaN', () => {
      expect(formatDuration(NaN)).toBe('0ms');
    });

    it('AC15: returns "0ms" for Infinity', () => {
      expect(formatDuration(Infinity)).toBe('0ms');
    });

    it('AC16: returns "0ms" for -Infinity', () => {
      expect(formatDuration(-Infinity)).toBe('0ms');
    });

    it('AC17: returns "0ms" for -0', () => {
      expect(formatDuration(-0)).toBe('0ms');
    });
  });

  describe('millisecond range (0 < ms < 1000)', () => {
    it('AC2: returns "820ms" for 820', () => {
      expect(formatDuration(820)).toBe('820ms');
    });

    it('AC3: returns "821ms" for 820.6 (nearest-integer rounding)', () => {
      expect(formatDuration(820.6)).toBe('821ms');
    });

    it('AC4: returns "999ms" for 999', () => {
      expect(formatDuration(999)).toBe('999ms');
    });
  });

  describe('second range (1000 <= ms < 60000)', () => {
    it('AC5: returns "1s" for 1000 (exact boundary)', () => {
      expect(formatDuration(1000)).toBe('1s');
    });

    it('AC6: returns "5s" for 5000', () => {
      expect(formatDuration(5000)).toBe('5s');
    });
  });

  describe('minute range (60000 <= ms < 3600000) and carry from seconds', () => {
    it('AC7: returns "1m 0s" for 59999 (rounds up to 60s, carries to 1m)', () => {
      expect(formatDuration(59999)).toBe('1m 0s');
    });

    it('AC8: returns "1m 0s" for 60000 (exact boundary)', () => {
      expect(formatDuration(60000)).toBe('1m 0s');
    });

    it('AC9: returns "1m 5s" for 65000', () => {
      expect(formatDuration(65000)).toBe('1m 5s');
    });

    it('AC10: returns "1m 6s" for 65999 (second rounding)', () => {
      expect(formatDuration(65999)).toBe('1m 6s');
    });
  });

  describe('hour range (ms >= 3600000) and carry from minutes', () => {
    it('AC11: returns "1h 0m" for 3599999 (rounds up to 60m, carries to 1h)', () => {
      expect(formatDuration(3599999)).toBe('1h 0m');
    });

    it('AC12: returns "1h 0m" for 3600000 (exact boundary)', () => {
      expect(formatDuration(3600000)).toBe('1h 0m');
    });

    it('large value: returns "2h 30m" for 9000000', () => {
      expect(formatDuration(9000000)).toBe('2h 30m');
    });
  });
});
