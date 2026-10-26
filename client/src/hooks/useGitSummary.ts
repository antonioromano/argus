import { useEffect, useState } from 'react';
import type { GitSummary } from '@argus/shared';
import { api } from '../services/api.js';

export const GIT_SUMMARY_POLL_MS = 5000;

export interface GitSummaryState {
  /** undefined until the first answer; null when the work root isn't a repo. */
  summary: GitSummary | null | undefined;
  error: string | null;
}

/**
 * Branch, upstream, ahead/behind and changed files of one session, polled while
 * `enabled` (the Inspector's Git section is on screen). `refreshKey` triggers
 * an immediate refetch — pass something that changes with the session's git
 * state (its dirty flag, the shell's cwd) so a new commit shows without waiting
 * for the next tick.
 */
export function useGitSummary(sessionId: string | null, enabled: boolean, refreshKey?: unknown): GitSummaryState {
  const [state, setState] = useState<GitSummaryState & { id: string | null }>({ id: null, summary: undefined, error: null });

  useEffect(() => {
    if (!sessionId || !enabled) return;
    let alive = true;
    const load = () => {
      api.getGitSummary(sessionId)
        .then(({ summary }) => { if (alive) setState({ id: sessionId, summary, error: null }); })
        .catch((err: unknown) => {
          if (alive) setState((prev) => ({ ...prev, id: sessionId, error: err instanceof Error ? err.message : String(err) }));
        });
    };
    load();
    const t = setInterval(load, GIT_SUMMARY_POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [sessionId, enabled, refreshKey]);

  // Another session's answer must never show under this one while it loads.
  if (state.id !== sessionId) return { summary: undefined, error: null };
  return { summary: state.summary, error: state.error };
}
