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
  ownerOf: (sessionId: string) => string;
  labelOf: (windowId: string) => string;
  isForeign: (sessionId: string) => boolean;
  moveToWindow: (sessionId: string, windowId: string) => Promise<void>;
  moveToNewWindow: (sessionId: string) => Promise<void>;
  mergeAllHere: () => Promise<void>;
  focusWindow: (windowId: string) => Promise<void>;
}

export function useWindows(socket: TypedSocket): WindowsApi {
  const [state, setState] = useState<WindowRegistryState>(EMPTY);

  useEffect(() => {
    api.getWindows().then(setState).catch(console.error);
    const onState = (s: WindowRegistryState) => setState(s);
    socket.on('window:state', onState);
    return () => { socket.off('window:state', onState); };
  }, [socket]);

  const ownerOf = useCallback(
    (sessionId: string) => state.assignments[sessionId] ?? MAIN_WINDOW_ID,
    [state],
  );
  const labelOf = useCallback(
    (windowId: string) => state.windows.find((w) => w.id === windowId)?.label ?? 'Main',
    [state],
  );
  const isForeign = useCallback(
    (sessionId: string) => ownerOf(sessionId) !== myWindowId,
    [ownerOf],
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

  return { myWindowId, windows: state.windows, ownerOf, labelOf, isForeign, moveToWindow, moveToNewWindow, mergeAllHere, focusWindow };
}
