/** Beta F12 helpers for HandoffSheet (kept apart so the sheet file only exports components). */

export const HANDOFF_DEFAULT_MESSAGES = 10;
export const HANDOFF_MAX_MESSAGES = 50;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}
