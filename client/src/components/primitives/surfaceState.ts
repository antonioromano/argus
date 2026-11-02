/**
 * The one state a data surface renders (plan 2026-10-29-003, R1):
 * - loading: no data yet (a skeleton after 300 ms);
 * - empty:   loaded, nothing to show (one sentence, at most one action);
 * - error:   nothing to show because the load failed (cause + actions);
 * - ready:   data;
 * - stale:   data, but the last refresh failed (keep it, one-line notice above).
 */
export type SurfaceState = 'loading' | 'empty' | 'error' | 'ready' | 'stale';

export interface SurfaceStateInput<T> {
  /** Last good data; `undefined` / `null` = never loaded. */
  data: T | null | undefined;
  /** The last load's failure, if it failed. */
  error?: unknown;
  /** A load is in flight. */
  loading?: boolean;
  /** Emptiness for non-array data. Arrays default to `length === 0`. */
  isEmpty?: (data: T) => boolean;
}

/** Pure: which state a surface is in. A load in flight never reads as empty. */
export function deriveSurfaceState<T>({ data, error, loading = false, isEmpty }: SurfaceStateInput<T>): SurfaceState {
  const hasError = error !== undefined && error !== null && error !== false;
  if (data === undefined || data === null) {
    return hasError && !loading ? 'error' : 'loading';
  }
  const empty = isEmpty ? isEmpty(data) : Array.isArray(data) && data.length === 0;
  if (empty) {
    if (loading) return 'loading';
    return hasError ? 'error' : 'empty';
  }
  return hasError ? 'stale' : 'ready';
}
