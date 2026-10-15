// Beta F6 activity panel helpers (kept out of the component file for fast refresh).

/** Same cap as the server ring. */
export const ACTIVITY_CLIENT_CAP = 500;

/** "now", "42s", "5m", "3h", "2d" — compact, for a narrow rail. */
export function relativeTime(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 5) return 'now';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
