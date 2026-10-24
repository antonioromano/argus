import { useCallback, useEffect, useRef, useState } from 'react';
import type { GitCommitDetail, GitCommitSummary, GitRefsResponse } from '@argus/shared';
import { api } from '../services/api.js';

export const GIT_HISTORY_PAGE = 50;
/** The server's largest page; a refresh reloads at most this many commits. */
const GIT_HISTORY_MAX_PAGE = 200;
/** How often the tip is checked for commits the session's git signals missed. */
export const GIT_HISTORY_POLL_MS = 10_000;

export interface GitHistoryState {
  /** undefined until the first answer; null when the work root isn't a repo. */
  commits: GitCommitSummary[] | null | undefined;
  hasMore: boolean;
  /** A further page is being fetched. */
  loading: boolean;
  /** The last (re)load of the shown pages failed; what's shown is the previous reading. */
  error: string | null;
  /** The last "load more" failed; `loadMore` retries it. */
  loadMoreError: string | null;
  loadMore: () => void;
  refresh: () => void;
}

/** What identifies the history's tip: its hash and what points at it. */
function tipOf(commits: GitCommitSummary[] | null | undefined): string {
  const top = commits?.[0];
  return top ? `${top.hash}|${top.refs.map((r) => `${r.kind}:${r.name}:${r.current ? 1 : 0}`).join(',')}` : '';
}

/**
 * Paginated `git log` of a session (Git Manager, Inspector History card).
 * `ref` restarts from another branch/tag (default HEAD). `refreshKey` reloads
 * the pages already shown — pass something that moves with the session's git
 * state so a new commit appears at once. Commits those signals can't see (one
 * made while the tree stays dirty, a reset, a branch moved elsewhere) are
 * caught by a cheap one-commit check of the tip every GIT_HISTORY_POLL_MS.
 */
export function useGitHistory(
  sessionId: string,
  { ref, refreshKey, pageSize = GIT_HISTORY_PAGE, pollMs = GIT_HISTORY_POLL_MS }: { ref?: string; refreshKey?: unknown; pageSize?: number; pollMs?: number } = {},
): GitHistoryState {
  const [state, setState] = useState<{ key: string; commits: GitCommitSummary[] | null | undefined; hasMore: boolean; error: string | null; loadMoreError: string | null }>(
    { key: '', commits: undefined, hasMore: false, error: null, loadMoreError: null },
  );
  // Only "load more" reports loading; the first page shows as commits === undefined.
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const key = `${sessionId}|${ref ?? ''}`;
  // Requests from a previous session/ref (or an older reload) must not land.
  const seq = useRef(0);
  // How many commits are shown (so a reload brings back as many) and their tip.
  const loadedRef = useRef({ key: '', n: 0, tip: '' });

  useEffect(() => {
    const my = ++seq.current;
    const shown = loadedRef.current.key === key ? loadedRef.current.n : 0;
    const limit = Math.min(Math.max(pageSize, shown), GIT_HISTORY_MAX_PAGE);
    api.getGitHistory(sessionId, { limit, ref })
      .then((r) => {
        if (seq.current !== my) return;
        loadedRef.current = { key, n: r.commits?.length ?? 0, tip: tipOf(r.commits) };
        setState({ key, commits: r.commits, hasMore: r.hasMore, error: null, loadMoreError: null });
      })
      .catch((err: unknown) => {
        if (seq.current !== my) return;
        const error = err instanceof Error ? err.message : String(err);
        setState((prev) => (prev.key === key
          ? { ...prev, error }
          : { key, commits: undefined, hasMore: false, error, loadMoreError: null }));
      })
      .finally(() => { if (seq.current === my) setLoading(false); });
  }, [sessionId, ref, key, pageSize, refreshKey, tick]);

  // Reload when the tip moved behind the signals' back.
  useEffect(() => {
    if (pollMs <= 0) return;
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (loadedRef.current.key !== key) return;
      const before = loadedRef.current.tip;
      api.getGitHistory(sessionId, { limit: 1, ref })
        .then((r) => {
          if (loadedRef.current.key === key && loadedRef.current.tip === before && tipOf(r.commits) !== before) setTick((n) => n + 1);
        })
        .catch(() => { /* the next full reload reports errors */ });
    }, pollMs);
    return () => clearInterval(t);
  }, [sessionId, ref, key, pollMs]);

  const current = state.key === key ? state : { commits: undefined, hasMore: false, error: null, loadMoreError: null };

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
          loadedRef.current = { key, n: commits.length, tip: tipOf(commits) };
          return { ...prev, commits, hasMore: r.hasMore, loadMoreError: null };
        });
      })
      .catch((err: unknown) => {
        if (seq.current === my) setState((prev) => ({ ...prev, loadMoreError: err instanceof Error ? err.message : String(err) }));
      })
      .finally(() => { if (seq.current === my) setLoading(false); });
  }, [loading, current.hasMore, current.commits, sessionId, pageSize, ref, key]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  return { commits: current.commits, hasMore: current.hasMore, error: current.error, loadMoreError: current.loadMoreError, loading, loadMore, refresh };
}

// A commit's content never changes, but what points at it (its refs) does:
// keep the last few details so stepping through the history doesn't refetch
// them, and refetch one when `refreshKey` moves.
const DETAIL_CACHE_MAX = 30;
const detailCache = new Map<string, { detail: GitCommitDetail; token: string }>();

export interface GitCommitDetailState {
  detail: GitCommitDetail | undefined;
  error: string | null;
  /** Fetch again (after an error, or to update refs). */
  retry: () => void;
}

/** Message, files and diff of one commit; `hash` null shows nothing. */
export function useGitCommitDetail(sessionId: string, hash: string | null, refreshKey?: unknown): GitCommitDetailState {
  const cacheKey = hash ? `${sessionId}:${hash}` : '';
  const [state, setState] = useState<{ key: string; detail?: GitCommitDetail; error: string | null }>({ key: '', error: null });
  const [tick, setTick] = useState(0);
  const token = `${String(refreshKey ?? '')}|${tick}`;

  useEffect(() => {
    if (!hash || detailCache.get(cacheKey)?.token === token) return;
    let alive = true;
    api.getGitCommitDetail(sessionId, hash)
      .then((detail) => {
        // Re-insert so the cache drops the least recently fetched entry.
        detailCache.delete(cacheKey);
        detailCache.set(cacheKey, { detail, token });
        while (detailCache.size > DETAIL_CACHE_MAX) detailCache.delete(detailCache.keys().next().value!);
        if (alive) setState({ key: cacheKey, detail, error: null });
      })
      .catch((err: unknown) => { if (alive) setState({ key: cacheKey, error: err instanceof Error ? err.message : String(err) }); });
    return () => { alive = false; };
  }, [sessionId, hash, cacheKey, token]);

  const retry = useCallback(() => setTick((t) => t + 1), []);
  // A cached reading shows at once, even while a refetch is in flight.
  const cached = cacheKey ? detailCache.get(cacheKey)?.detail : undefined;
  if (cached) return { detail: cached, error: null, retry };
  if (state.key !== cacheKey) return { detail: undefined, error: null, retry };
  return { detail: state.detail, error: state.error, retry };
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
