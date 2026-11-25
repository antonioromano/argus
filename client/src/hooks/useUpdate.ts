import { useState, useEffect, useCallback } from 'react';
import type { UpdateStatus, UpdateProgress } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { api } from '../services/api.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface UpdateFailure {
  error: string;
  /** Not a real failure — Phase 1 found no newer version. Rendered as info. */
  upToDate?: boolean;
}

/** Longest a first-run surface waits on the update check. */
const CHECK_SETTLE_MS = 8000;

export function useUpdate(socket: TypedSocket) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [failure, setFailure] = useState<UpdateFailure | null>(null);
  // The first check has answered, failed, or taken too long. Callers that only
  // wait for it (first-run surfaces) use this, so a slow or failing GitHub
  // check never holds them back for the whole session.
  const [checkSettled, setCheckSettled] = useState(false);

  useEffect(() => {
    const settle = () => setCheckSettled(true);
    const timer = setTimeout(settle, CHECK_SETTLE_MS);
    api.checkUpdate().then(setStatus).catch(console.error).finally(() => { clearTimeout(timer); settle(); });
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleAvailable = (newStatus: UpdateStatus) => setStatus(newStatus);
    const handleProgress = (p: UpdateProgress) => { setFailure(null); setProgress(p); };
    const handleFailed = (f: UpdateFailure) => { setProgress(null); setFailure(f); };
    socket.on('update:available', handleAvailable);
    socket.on('update:progress', handleProgress);
    socket.on('update:failed', handleFailed);
    return () => {
      socket.off('update:available', handleAvailable);
      socket.off('update:progress', handleProgress);
      socket.off('update:failed', handleFailed);
    };
  }, [socket]);

  // Called before a fresh apply / retry so stale progress or errors don't linger.
  const resetUpdateState = useCallback(() => { setProgress(null); setFailure(null); }, []);

  return { status, progress, failure, resetUpdateState, checkSettled };
}
