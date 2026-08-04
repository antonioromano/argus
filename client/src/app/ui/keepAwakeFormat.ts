export interface KeepAwakeOption {
  label: string;
  /** Right-aligned muted shorthand in the menu. */
  hint: string;
  /** null = indefinitely. */
  durationMs: number | null;
}

/**
 * The windows offered by the toolbar menu. Must stay in step with the server's
 * KEEP_AWAKE_DURATIONS_MS allowlist — anything else comes back a 400.
 */
export const KEEP_AWAKE_OPTIONS: readonly KeepAwakeOption[] = [
  { label: '5 minutes', hint: '5m', durationMs: 5 * 60_000 },
  { label: '15 minutes', hint: '15m', durationMs: 15 * 60_000 },
  { label: '30 minutes', hint: '30m', durationMs: 30 * 60_000 },
  { label: '1 hour', hint: '1h', durationMs: 60 * 60_000 },
  { label: '2 hours', hint: '2h', durationMs: 120 * 60_000 },
  { label: '4 hours', hint: '4h', durationMs: 240 * 60_000 },
  { label: 'Indefinitely', hint: '∞', durationMs: null },
];

/** Milliseconds left, clamped at 0. `null` (off or indefinite) yields 0. */
export function remainingMs(expiresAt: number | null, now: number): number {
  if (expiresAt === null) return 0;
  return Math.max(0, expiresAt - now);
}

/**
 * `H:MM:SS` at or above an hour, `M:SS` below. Rounds up so an armed 30-minute
 * window reads "30:00" rather than "29:59" on its first paint.
 */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
