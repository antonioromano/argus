import { useCallback, useEffect, useState } from 'react';
import type { SessionPrDiffResponse } from '@argus/shared';
import { api } from '../services/api.js';

export interface PrDiffState {
  /** undefined until the first answer; a refresh keeps showing the last one. */
  diff: SessionPrDiffResponse | undefined;
  error: string | null;
  refresh: () => void;
}

/**
 * One PR's diff (B4), read once per open and again on `refresh()`. A PR diff
 * can be megabytes, so nothing is cached beyond the open view.
 */
export function usePrDiff(sessionId: string, url: string): PrDiffState {
  const key = `${sessionId}\0${url}`;
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<{ key: string; diff?: SessionPrDiffResponse; error: string | null }>({ key: '', error: null });

  useEffect(() => {
    let alive = true;
    api.getSessionPrDiff(sessionId, url)
      .then((diff) => { if (alive) setState({ key, diff, error: null }); })
      // A failed refresh keeps the last diff underneath the error.
      .catch((err: unknown) => {
        if (alive) setState((s) => ({ key, diff: s.key === key ? s.diff : undefined, error: err instanceof Error ? err.message : String(err) }));
      });
    return () => { alive = false; };
  }, [sessionId, url, key, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  // Same PR: keep showing the last reading (scroll and collapse state survive) while a refresh runs.
  if (state.key !== key) return { diff: undefined, error: null, refresh };
  return { diff: state.diff, error: state.error, refresh };
}
