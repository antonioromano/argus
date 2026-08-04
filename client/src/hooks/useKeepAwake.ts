import { useState, useEffect, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, KeepAwakeStatus } from '@argus/shared';
import { api } from '../services/api.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Manual keep-awake window (the toolbar CTA).
 *
 * The server owns expiry — this hook never decides when the window ends, it only
 * mutates over REST and renders what the server broadcasts. Status is re-fetched
 * on reconnect so a broadcast missed while disconnected heals itself.
 */
export function useKeepAwake(socket: TypedSocket) {
  const [status, setStatus] = useState<KeepAwakeStatus | null>(null);

  useEffect(() => {
    api.getKeepAwake().then(setStatus).catch(console.error);
  }, []);

  useEffect(() => {
    const handleStatus = (next: KeepAwakeStatus) => setStatus(next);
    const resync = () => { api.getKeepAwake().then(setStatus).catch(console.error); };
    socket.on('keepawake:status', handleStatus);
    socket.on('connect', resync);
    return () => {
      socket.off('keepawake:status', handleStatus);
      socket.off('connect', resync);
    };
  }, [socket]);

  // No optimistic update: the response IS the authoritative state, and arming can
  // legitimately fail (a blocker the OS refuses), which must not leave the pill on.
  const arm = useCallback(async (durationMs: number | null) => {
    try {
      setStatus(await api.armKeepAwake(durationMs));
    } catch (err) {
      console.error('[keep-awake] arm failed:', err);
    }
  }, []);

  const disarm = useCallback(async () => {
    try {
      setStatus(await api.disarmKeepAwake());
    } catch (err) {
      console.error('[keep-awake] disarm failed:', err);
    }
  }, []);

  return { status, arm, disarm };
}
