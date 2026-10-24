import { useCallback, useEffect, useRef, useState } from 'react';
import type { GitCommitDetail, GitCommitSummary, GitRefsResponse } from '@argus/shared';
import { api } from '../services/api.js';

export const GIT_HISTORY_PAGE = 50;
/** The server's largest page; a refresh reloads at most this many commits. */
const GIT_HISTORY_MAX_PAGE = 200;

export interface GitHistoryState {
  /** undefined until the first answer; null when the work root isn't a repo. */
  commits: GitCommitSummary[] | null | undefined;
  hasMore: boolean;
  /** A further page is being fetched. */
  loading: boolean;
  error: string | null;
  loadMore: () => void;
  refresh: () => void;
}

/**
 * Paginated `git log` of a session (Git Manager, Inspector History card).
 * `ref` restarts from another branch/tag (default HEAD). `refreshKey` reloads
 * the pages already shown — pass something that moves with the session's git
 * state so a new commit appears without a manual refresh.
 */
export function useGitHistory(
  sessionId: string,
  { ref, refreshKey, pageSize = GIT_HISTORY_PAGE }: { ref?: string; refreshKey?: unknown; pageSize?: number } = {},
): GitHistoryState {
  const [state, setState] = useState<{ key: string; commits: GitCommitSummary[] | null | undefined; hasMore: boolean; error: string | null }>(
    { key: '', commits: undefined, hasMore: false, error: null },
  );
  // Only "load more" reports loading; the first page shows as commits === undefined.
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const key = `${sessionId}|${ref ?? ''}`;
  // Requests from a previous session/ref (or an older reload) must not land.
  const seq = useRef(0);
  // How many commits are shown, so a reload brings back as many.
  const loadedRef = useRef({ key: '', n: 0 });

  useEffect(() => {
    const my = ++seq.current;
    const shown = loadedRef.current.key === key ? loadedRef.current.n : 0;
    const limit = Math.min(Math.max(pageSize, shown), GIT_HISTORY_MAX_PAGE);
    api.getGitHistory(sessionId, { limit, ref })
      .then((r) => {
        if (seq.current !== my) return;
        loadedRef.current = { key, n: r.commits?.length ?? 0 };
        setState({ key, commits: r.commits, hasMore: r.hasMore, error: null });
      })
      .catch((err: unknown) => {
        if (seq.current === my) setState((prev) => ({ ...(prev.key === key ? prev : { commits: undefined, hasMore: false }), key, error: err instanceof Error ? err.message : String(err) }));
      })
      .finally(() => { if (seq.current === my) setLoading(false); });
  }, [sessionId, ref, key, pageSize, refreshKey, tick]);

  const current = state.key === key ? state : { commits: undefined, hasMore: false, error: null };

  const loadMore = useCallback(() => {
    if (loading || !current.hasMore || !current.commits) return;
    const my = ++seq.current;
    const skip = current.commits.length;
    setLoading(true);
    api.getGitHistory(sessionId, { skip, limit: pageSize, ref })
      .then((r) => {
        if (seq.current !== my) return;
        setState((prev) => {
          if (prev.key !== key || !prev.commits) return prev;
          const commits = [...prev.commits.slice(0, skip), ...(r.commits ?? [])];
          loadedRef.current = { key, n: commits.length };
          return { key, commits, hasMore: r.hasMore, error: null };
        });
      })
      .catch((err: unknown) => { if (seq.current === my) setState((prev) => ({ ...prev, error: err instanceof Error ? err.message : String(err) })); })
      .finally(() => { if (seq.current === my) setLoading(false); });
  }, [loading, current.hasMore, current.commits, sessionId, pageSize, ref, key]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  return { commits: current.commits, hasMore: current.hasMore, error: current.error, loading, loadMore, refresh };
}

// A commit's content never changes: keep the last few details so stepping
// back and forth through the history doesn't refetch them.
const DETAIL_CACHE_MAX = 30;
const detailCache = new Map<string, GitCommitDetail>();

export interface GitCommitDetailState {
  detail: GitCommitDetail | undefined;
  error: string | null;
}

/** Message, files and diff of one commit; `hash` null shows nothing. */
export function useGitCommitDetail(sessionId: string, hash: string | null): GitCommitDetailState {
  const cacheKey = hash ? `${sessionId}:${hash}` : '';
  const [state, setState] = useState<{ key: string; detail?: GitCommitDetail; error: string | null }>({ key: '', error: null });

  useEffect(() => {
    if (!hash || detailCache.has(cacheKey)) return;
    let alive = true;
    api.getGitCommitDetail(sessionId, hash)
      .then((detail) => {
        detailCache.set(cacheKey, detail);
        while (detailCache.size > DETAIL_CACHE_MAX) detailCache.delete(detailCache.keys().next().value!);
        if (alive) setState({ key: cacheKey, detail, error: null });
      })
      .catch((err: unknown) => { if (alive) setState({ key: cacheKey, error: err instanceof Error ? err.message : String(err) }); });
    return () => { alive = false; };
  }, [sessionId, hash, cacheKey]);

  const cached = cacheKey ? detailCache.get(cacheKey) : undefined;
  if (cached) return { detail: cached, error: null };
  if (state.key !== cacheKey) return { detail: undefined, error: null };
  return { detail: state.detail, error: state.error };
}

/** Test hook: forget cached commit details. */
export function clearGitCommitDetailCache(): void {
  detailCache.clear();
}

export interface GitRefsState {
  /** undefined until the first answer; null when the work root isn't a repo. */
  refs: GitRefsResponse['refs'] | undefined;
  error: string | null;
  refresh: () => void;
}

/** Branches (local + remote) and worktrees of a session's repo. */
export function useGitRefs(sessionId: string, refreshKey?: unknown): GitRefsState {
  const [state, setState] = useState<{ id: string; refs: GitRefsResponse['refs'] | undefined; error: string | null }>({ id: '', refs: undefined, error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    api.getGitRefs(sessionId)
      .then(({ refs }) => { if (alive) setState({ id: sessionId, refs, error: null }); })
      .catch((err: unknown) => { if (alive) setState((prev) => ({ ...prev, id: sessionId, error: err instanceof Error ? err.message : String(err) })); });
    return () => { alive = false; };
  }, [sessionId, refreshKey, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  if (state.id !== sessionId) return { refs: undefined, error: null, refresh };
  return { refs: state.refs, error: state.error, refresh };
}
