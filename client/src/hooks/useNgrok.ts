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

  const refreshStatus = useCallback(() => {
    api.getNgrokStatus().then(setStatus).catch(console.error);
  }, []);

  // Broadcasts sent while the socket is down are lost, and starting a tunnel
  // takes it down on purpose: setting the password drops every tokenless socket
  // before ngrok reports `connected`. Re-read the status on every (re)connect.
  useEffect(() => {
    refreshStatus();
    const handleStatus = (newStatus: NgrokStatus) => setStatus(newStatus);
    socket.on('ngrok:status', handleStatus);
    socket.on('connect', refreshStatus);
    return () => {
      socket.off('ngrok:status', handleStatus);
      socket.off('connect', refreshStatus);
    };
  }, [socket, refreshStatus]);

  const startTunnel = useCallback(async (password: string) => {
    setLoading(true);
    setError(null);
    try {
      await api.startNgrok(undefined, password);
      // Don't wait for the socket to come back with the token to show the QR.
      refreshStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start tunnel';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [refreshStatus]);

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
