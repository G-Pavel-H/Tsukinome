export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '0ms';
  }

  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  const s = Math.round(ms / 1000);

  if (s < 60) {
    return `${s}s`;
  }

  const m = Math.floor(s / 60);
  const rem = s % 60;

  if (m < 60) {
    return `${m}m ${rem}s`;
  }

  const mTotal = Math.round(ms / 60000);
  const h = Math.floor(mTotal / 60);
  const remM = mTotal % 60;

  return `${h}h ${remM}m`;
}
