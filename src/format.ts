/**
 * Pure formatting utilities.
 */

/**
 * Converts a millisecond count into a compact human-readable string.
 *
 * - Non-finite or negative (including -0)  → "0ms"
 * - 0                                       → "0ms"
 * - 1–999ms                                 → "<n>ms" (rounded to whole ms)
 * - 1000–59999ms                            → "<n>s"  (floored, sub-second dropped)
 * - 60000–3599999ms                         → "Xm Ys" (floored sub-units)
 * - ≥ 3600000ms                             → "Xh Ym" (floored, seconds dropped)
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0ms';
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${Math.floor(ms / 1_000)}s`;
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1_000);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}
