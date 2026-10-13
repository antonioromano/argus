/**
 * Bound a client-sent terminal size. node-pty only rejects ≤0/NaN/Infinity, so
 * `{cols: 100000, rows: 100000}` reached the headless xterm mirror and its
 * allocation could OOM the server — which runs inside Electron main, taking
 * every session with it. Returns null for anything that isn't a number.
 */
export const GRID_LIMITS = { minCols: 2, maxCols: 1000, minRows: 2, maxRows: 500 } as const;

export function clampGrid(cols: unknown, rows: unknown): { cols: number; rows: number } | null {
  if (typeof cols !== 'number' || typeof rows !== 'number') return null;
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) return null;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.trunc(v)));
  return {
    cols: clamp(cols, GRID_LIMITS.minCols, GRID_LIMITS.maxCols),
    rows: clamp(rows, GRID_LIMITS.minRows, GRID_LIMITS.maxRows),
  };
}
