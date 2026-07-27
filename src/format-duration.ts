/**
 * Converts a millisecond count into a compact human-readable string.
 *
 * | Range                  | Format   | Example              |
 * | ---------------------- | -------- | -------------------- |
 * | non-finite / ≤ 0 / ~0  | "0ms"    | NaN, -5, 0.4 → "0ms" |
 * | (0, 1000)              | "<n>ms"  | 820.6 → "821ms"      |
 * | [1000, 60000)          | "<n>s"   | 5999 → "5s"          |
 * | [60000, 3600000)       | "<m>m <s>s" | 65000 → "1m 5s"   |
 * | ≥ 3600000              | "<h>h <m>m" | 7380000 → "2h 3m" |
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '0ms';
  }

  if (ms < 1000) {
    const rounded = Math.round(ms);
    if (rounded === 0) return '0ms';
    return `${rounded}ms`;
  }

  if (ms < 60_000) {
    const s = Math.floor(ms / 1000);
    return `${s}s`;
  }

  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return `${m}m ${s}s`;
  }

  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}
