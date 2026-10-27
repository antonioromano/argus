import { useCallback, useState } from 'react';
import type { SessionViewMode } from '@argus/shared';

export type { SessionViewMode };

const STORAGE_KEY = 'argus.sessionViewMode';
/** Sessions remembered; the oldest choices are dropped past this. */
const MAX_REMEMBERED = 200;

function readAll(): Record<string, SessionViewMode> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    // An array would pass the object check, but JSON.stringify drops named keys on it.
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, SessionViewMode>) : {};
  } catch {
    return {};
  }
}

/** The explicit choice stored for a session, or undefined when it has none. */
export function readStoredViewMode(sessionId: string): SessionViewMode | undefined {
  const mode = readAll()[sessionId];
  return mode === 'chat' || mode === 'terminal' ? mode : undefined;
}

export function readViewMode(sessionId: string, fallback: SessionViewMode = 'terminal'): SessionViewMode {
  return readStoredViewMode(sessionId) ?? fallback;
}

export function writeViewMode(sessionId: string, mode: SessionViewMode): void {
  try {
    const all = readAll();
    delete all[sessionId]; // re-insert last so it counts as most recent
    // Both choices are stored: the default is a setting, so 'terminal' is no
    // longer implied by a missing entry.
    all[sessionId] = mode;
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED))) delete all[k];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: the choice just isn't remembered */
  }
}

/**
 * Per-session Terminal/Chat choice (B1), remembered in this browser. A session
 * with no stored choice follows `fallback` (the defaultSessionView setting), and
 * keeps following it live, so a config that loads late or changes still applies.
 * A null fallback means the config is still loading: the mode is then null too
 * (unless the session has a stored choice), so the caller can wait instead of
 * showing a view it may switch away from a moment later.
 */
export function useChatViewMode(
  sessionId: string,
  fallback: SessionViewMode | null,
): [SessionViewMode | null, (mode: SessionViewMode) => void] {
  const [state, setState] = useState(() => ({ sessionId, stored: readStoredViewMode(sessionId) }));
  // Adjust during render when the session changes.
  const current = state.sessionId === sessionId ? state : { sessionId, stored: readStoredViewMode(sessionId) };
  if (current !== state) setState(current);
  const setMode = useCallback(
    (mode: SessionViewMode) => {
      writeViewMode(sessionId, mode);
      setState({ sessionId, stored: mode });
    },
    [sessionId],
  );
  return [current.stored ?? fallback, setMode];
}
