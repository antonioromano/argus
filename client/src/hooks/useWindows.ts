import { useCallback, useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { MAIN_WINDOW_ID, type ArgusWindow, type ClientToServerEvents, type ServerToClientEvents, type WindowRegistryState } from '@argus/shared';
import { api } from '../services/api.js';
import { myWindowId } from '../utils/windowId.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const EMPTY: WindowRegistryState = { windows: [], assignments: {} };

export interface WindowsApi {
  myWindowId: string;
  windows: ArgusWindow[];
  /** False until the first successful GET /api/windows resolves or the first
   *  window:state broadcast lands. Gates callers (e.g. isForeign consumers)
   *  that would otherwise treat an unpopulated registry as "everything foreign". */
  loaded: boolean;
  ownerOf: (sessionId: string) => string;
  labelOf: (windowId: string) => string;
  isForeign: (sessionId: string) => boolean;
  moveToWindow: (sessionId: string, windowId: string) => Promise<void>;
  moveToNewWindow: (sessionId: string) => Promise<void>;
  mergeAllHere: () => Promise<void>;
  focusWindow: (windowId: string) => Promise<void>;
}

// ---- Pure helpers (exported for unit testing without mounting the hook) ----

export function computeOwnerOf(state: WindowRegistryState, sessionId: string): string {
  return state.assignments[sessionId] ?? MAIN_WINDOW_ID;
}

export function computeLabelOf(state: WindowRegistryState, windowId: string): string {
  return state.windows.find((w) => w.id === windowId)?.label ?? 'Main';
}

/** While the registry hasn't loaded yet, default to "not foreign" — the safe
 *  choice that avoids both false focus-ejection and an all-foreign chip flash
 *  on startup, before any assignment is known. */
export function computeIsForeign(
  state: WindowRegistryState,
  sessionId: string,
  myId: string,
  loaded: boolean,
): boolean {
  if (!loaded) return false;
  return computeOwnerOf(state, sessionId) !== myId;
}

export function useWindows(socket: TypedSocket): WindowsApi {
  const [state, setState] = useState<WindowRegistryState>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const fetchState = () => {
      api.getWindows().then((s) => { setState(s); setLoaded(true); }).catch(console.error);
    };
    fetchState();
    const onState = (s: WindowRegistryState) => { setState(s); setLoaded(true); };
    socket.on('window:state', onState);
    // Mirrors useSessions: a missed broadcast (or a failed initial fetch) while
    // disconnected would otherwise leave this window treating its own sessions
    // as foreign forever — refetch whenever the socket (re)connects.
    socket.on('connect', fetchState);
    return () => {
      socket.off('window:state', onState);
      socket.off('connect', fetchState);
    };
  }, [socket]);

  const ownerOf = useCallback(
    (sessionId: string) => computeOwnerOf(state, sessionId),
    [state],
  );
  const labelOf = useCallback(
    (windowId: string) => computeLabelOf(state, windowId),
    [state],
  );
  const isForeign = useCallback(
    (sessionId: string) => computeIsForeign(state, sessionId, myWindowId, loaded),
    [state, loaded],
  );

  const moveToWindow = useCallback(
    (sessionId: string, windowId: string) => api.assignWindow(sessionId, windowId),
    [],
  );
  const moveToNewWindow = useCallback(
    async (sessionId: string) => { await api.createWindow(sessionId); },
    [],
  );
  const mergeAllHere = useCallback(() => api.mergeAllWindows(myWindowId), []);
  const focusWindow = useCallback((windowId: string) => api.focusWindow(windowId), []);

  return { myWindowId, windows: state.windows, loaded, ownerOf, labelOf, isForeign, moveToWindow, moveToNewWindow, mergeAllHere, focusWindow };
}
