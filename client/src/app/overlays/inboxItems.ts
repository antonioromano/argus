import type { SessionInfo } from '@argus/shared';

/** Every session waiting on the user, longest-waiting first. */
export function waitingItems(sessions: readonly SessionInfo[]): SessionInfo[] {
  return sessions
    .filter((s) => s.status === 'waiting')
    .sort((a, b) => (a.waitingSince ?? Infinity) - (b.waitingSince ?? Infinity));
}

/** 8_000 → "8s", 125_000 → "2m", 3_900_000 → "1h 5m". */
export function formatWaiting(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** The option a digit key picks for this session, if its menu was read reliably. */
export function optionForKey(session: SessionInfo, key: string): string | undefined {
  return session.promptOptions?.find((o) => o.key === key)?.key;
}
