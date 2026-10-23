import { useCallback, useState } from 'react';

export type SessionViewMode = 'terminal' | 'chat';

const STORAGE_KEY = 'argus.sessionViewMode';
/** Sessions remembered; the oldest choices are dropped past this. */
const MAX_REMEMBERED = 200;

function readAll(): Record<string, SessionViewMode> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, SessionViewMode>) : {};
  } catch {
    return {};
  }
}

export function readViewMode(sessionId: string): SessionViewMode {
  return readAll()[sessionId] === 'chat' ? 'chat' : 'terminal';
}

export function writeViewMode(sessionId: string, mode: SessionViewMode): void {
  try {
    const all = readAll();
    delete all[sessionId]; // re-insert last so it counts as most recent
    // Only the non-default choice is stored.
    if (mode === 'chat') all[sessionId] = mode;
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED))) delete all[k];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: the choice just isn't remembered */
  }
}

/**
 * Per-session Terminal/Chat choice (B1), remembered in this browser. The
 * terminal is the default; only sessions switched to chat are stored.
 */
export function useChatViewMode(sessionId: string): [SessionViewMode, (mode: SessionViewMode) => void] {
  const [state, setState] = useState(() => ({ sessionId, mode: readViewMode(sessionId) }));
  // Adjust during render when the session changes.
  const current = state.sessionId === sessionId ? state : { sessionId, mode: readViewMode(sessionId) };
  if (current !== state) setState(current);
  const setMode = useCallback(
    (mode: SessionViewMode) => {
      writeViewMode(sessionId, mode);
      setState({ sessionId, mode });
    },
    [sessionId],
  );
  return [current.mode, setMode];
}
