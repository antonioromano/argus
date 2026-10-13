/**
 * Coalesce a pty's output into ≤60fps emissions — the same policy as
 * SessionManager.emitOutput (see OUTPUT_COALESCE_MS there for the measured
 * reason: per-chunk socket messages starve React commits in the renderer).
 * Used for the companion terminals, which emitted per chunk.
 */
export const COALESCE_MS = 16;
/** Flush early if a burst accumulates this much before the timer fires. */
export const COALESCE_MAX_BYTES = 64 * 1024;

export interface OutputCoalescer {
  push(data: string): void;
  /** Emit anything pending now. Call before an exit event or a buffer replay,
   *  so nothing arrives after (or twice alongside) it. */
  flush(): void;
  /** Flush and stop: later pushes emit immediately (late bytes after exit). */
  dispose(): void;
}

export function createOutputCoalescer(
  emit: (data: string) => void,
  ms: number = COALESCE_MS,
  maxBytes: number = COALESCE_MAX_BYTES,
): OutputCoalescer {
  let pending = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!pending) return;
    const data = pending;
    pending = '';
    emit(data);
  };

  return {
    push(data) {
      if (disposed) {
        emit(data);
        return;
      }
      pending += data;
      if (pending.length >= maxBytes) {
        flush();
        return;
      }
      if (!timer) timer = setTimeout(flush, ms);
    },
    flush,
    dispose() {
      flush();
      disposed = true;
    },
  };
}
