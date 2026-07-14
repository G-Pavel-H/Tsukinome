/**
 * Converts a millisecond duration into a compact, human-readable string.
 *
 * Scale rules:
 *  - Non-finite or negative input → '0ms'
 *  - < 1 000 ms  → '<n>ms'
 *  - < 60 000 ms → '<n>s'
 *  - < 3 600 000 ms → '<m>m <s>s'
 *  - ≥ 3 600 000 ms → '<h>h <m>m'
 *
 * Sub-second values are rounded to whole milliseconds before scale selection,
 * so 999.6 rounds to 1 000 and is rendered as '1s'.
 */
export function formatDuration(ms: number): string {
  if (!isFinite(ms) || ms < 0) return '0ms';

  const rounded = Math.round(ms);

  if (rounded < 1_000) {
    return `${rounded}ms`;
  }

  if (rounded < 60_000) {
    return `${Math.floor(rounded / 1_000)}s`;
  }

  if (rounded < 3_600_000) {
    const minutes = Math.floor(rounded / 60_000);
    const seconds = Math.floor((rounded % 60_000) / 1_000);
    return `${minutes}m ${seconds}s`;
  }

  const hours = Math.floor(rounded / 3_600_000);
  const minutes = Math.floor((rounded % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m`;
}
