import { useState, useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import type { BackendHealth, ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { api } from '../services/api.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * argusd / tmux health for the status bar (plan 009 S1). The server debounces
 * flaps and broadcasts changes; this re-fetches on (re)connect so a change made
 * while the socket was down is not missed. Null until the first answer.
 */
export function useBackendHealth(socket: TypedSocket): BackendHealth | null {
  const [health, setHealth] = useState<BackendHealth | null>(null);

  useEffect(() => {
    const fetchHealth = () => { api.getBackendHealth().then(setHealth).catch(console.error); };
    fetchHealth();
    socket.on('backend:health', setHealth);
    socket.on('connect', fetchHealth);
    return () => {
      socket.off('backend:health', setHealth);
      socket.off('connect', fetchHealth);
    };
  }, [socket]);

  return health;
}
