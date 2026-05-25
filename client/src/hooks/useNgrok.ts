import { useState, useEffect, useCallback } from 'react';
import type { NgrokStatus } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { api, setToken } from '../services/api.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function useNgrok(socket: TypedSocket) {
  const [status, setStatus] = useState<NgrokStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getNgrokStatus().then(setStatus).catch(console.error);
  }, []);

  useEffect(() => {
    const handleStatus = (newStatus: NgrokStatus) => setStatus(newStatus);
    socket.on('ngrok:status', handleStatus);
    return () => { socket.off('ngrok:status', handleStatus); };
  }, [socket]);

  const startTunnel = useCallback(async (password: string) => {
    setLoading(true);
    setError(null);
    try {
      await api.startNgrok(undefined, password);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start tunnel';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const stopTunnel = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await api.stopNgrok();
      setToken(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to stop tunnel';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const recheckInstallation = useCallback(async () => {
    try {
      const newStatus = await api.recheckNgrok();
      setStatus(newStatus);
    } catch (err) {
      console.error(err);
    }
  }, []);

  return { status, loading, error, startTunnel, stopTunnel, recheckInstallation };
}
