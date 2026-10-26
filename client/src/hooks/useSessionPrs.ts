import { useEffect, useState, useSyncExternalStore } from 'react';
import type { SessionPrEntry } from '@argus/shared';
import { api } from '../services/api.js';

/** How often the open GitHub card asks again. The server's PR cache decides
 *  when `gh` actually runs (≈60 s while checks run, minutes otherwise). */
export const SESSION_PRS_POLL_MS = 30_000;

// The last list each session's card read, kept so the collapsed card's glance
// can still count PRs without fetching anything itself. Bounded, least
// recently read first out, so deleted sessions don't pile up.
const lastLists = new Map<string, SessionPrEntry[]>();
export const MAX_REMEMBERED_LISTS = 64;
const listeners = new Set<() => void>();

function remember(sessionId: string, prs: SessionPrEntry[]): void {
  lastLists.delete(sessionId); // re-insert as most recent
  lastLists.set(sessionId, prs);
  if (lastLists.size > MAX_REMEMBERED_LISTS) lastLists.delete(lastLists.keys().next().value as string);
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** The list the GitHub card last read for a session (undefined: never opened). No fetch. */
export function useLastSessionPrs(sessionId: string): SessionPrEntry[] | undefined {
  return useSyncExternalStore(subscribe, () => lastLists.get(sessionId));
}

/** Test hook: forget every remembered list. */
export function resetSessionPrsCache(): void {
  lastLists.clear();
  for (const l of listeners) l();
}

export interface SessionPrsState {
  /** undefined until the first answer. */
  prs: SessionPrEntry[] | undefined;
  /** false when the server says PR status is switched off. */
  enabled: boolean;
  error: string | null;
}

/**
 * Every PR of one session (B3), polled while `enabled` (the Inspector's GitHub
 * card is open). `refreshKey` triggers an immediate refetch — pass something
 * that changes with the session's PR chip so a new PR shows without waiting.
 */
export function useSessionPrs(sessionId: string, enabled: boolean, refreshKey?: unknown): SessionPrsState {
  const [state, setState] = useState<SessionPrsState & { id: string | null }>({ id: null, prs: undefined, enabled: true, error: null });

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () => {
      api.getSessionPrs(sessionId)
        .then((res) => {
          if (!alive) return;
          setState({ id: sessionId, prs: res.prs, enabled: res.enabled, error: null });
          remember(sessionId, res.prs);
        })
        .catch((err: unknown) => {
          if (alive) setState((prev) => ({ ...prev, id: sessionId, error: err instanceof Error ? err.message : String(err) }));
        });
    };
    load();
    const t = setInterval(load, SESSION_PRS_POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [sessionId, enabled, refreshKey]);

  // Another session's answer must never show under this one while it loads.
  if (state.id !== sessionId) return { prs: undefined, enabled: true, error: null };
  return { prs: state.prs, enabled: state.enabled, error: state.error };
}
