/**
 * Converts a millisecond count into a compact, human-readable string.
 *
 * - Zero, negative, or non-finite input → "0ms"
 * - < 1 s  → "Nms" (rounded to whole ms)
 * - < 1 m  → "Ns"
 * - < 1 h  → "Nm Ns"
 * - ≥ 1 h  → "Nh Nm"
 */
export function formatDuration(ms: number): string {
  if (!isFinite(ms) || ms <= 0) return '0ms';

  const roundedMs = Math.round(ms);

  if (roundedMs < 1000) {
    return `${roundedMs}ms`;
  }

  // Round to nearest second; handles carry (e.g. 59999ms → 60s → 1m 0s).
  const totalSecs = Math.round(roundedMs / 1000);

  if (totalSecs < 60) {
    return `${totalSecs}s`;
  }

  // Round to nearest minute for hour-scale bucketing; handles carry.
  const totalMins = Math.round(totalSecs / 60);

  if (totalMins < 60) {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}m ${secs}s`;
  }

  // Hour scale: drop seconds, show hours and minutes.
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return `${hours}h ${mins}m`;
}
