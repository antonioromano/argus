import { useEffect, useState, useSyncExternalStore } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { getToken } from '../services/api.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let sharedSocket: TypedSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleReconnect(ms: number): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (sharedSocket && !sharedSocket.connected) reconnectSocket();
  }, ms);
}

export function getSocket(): TypedSocket {
  if (!sharedSocket) {
    const token = getToken();
    const client = window.location.pathname.startsWith('/mobile') ? 'mobile' : 'desktop';
    sharedSocket = io({
      transports: ['websocket', 'polling'],
      query: { client },
      auth: token ? { token } : undefined,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
    });

    // Debug logging for socket lifecycle — noisy, dev-only. Errors stay on in
    // production since they matter for diagnosing tunnel/reconnect issues.
    if (import.meta.env.DEV) {
      sharedSocket.on('connect', () => {
        console.log('[socket] connected, id:', sharedSocket!.id);
      });
      sharedSocket.on('disconnect', (reason) => {
        console.log('[socket] disconnected, reason:', reason);
      });
      sharedSocket.io.on('reconnect_attempt', (attempt) => {
        console.log('[socket] reconnect_attempt #', attempt);
      });
      sharedSocket.io.on('reconnect', (attempt) => {
        console.log('[socket] reconnected after', attempt, 'attempts');
      });
    }
    // The server drops a socket when auth tightens under it (tunnel start,
    // password change, token expiry). socket.io never auto-reconnects after a
    // server-side disconnect or a middleware rejection, so retry here with the
    // CURRENT token — the window that started the tunnel (or another window
    // sharing localStorage) usually has a fresh one moments later.
    sharedSocket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') scheduleReconnect(1000);
    });
    sharedSocket.on('connect_error', (err) => {
      console.error('[socket] connect_error:', err.message);
      if (!sharedSocket!.active) scheduleReconnect(3000);
    });
    window.addEventListener('auth:authenticated', () => {
      if (!sharedSocket?.connected) reconnectSocket();
    });
    sharedSocket.io.on('reconnect_failed', () => {
      console.error('[socket] reconnect_failed — all attempts exhausted');
    });
  }
  return sharedSocket;
}

export function reconnectSocket(): void {
  if (sharedSocket) {
    const token = getToken();
    sharedSocket.auth = token ? { token } : {};
    sharedSocket.disconnect().connect();
  }
}

export function useSocket(): TypedSocket {
  const [socket] = useState<TypedSocket>(getSocket);

  useEffect(() => {
    if (!socket.connected) {
      socket.connect();
    }
  }, [socket]);

  return socket;
}

export function useSocketStatus(): boolean {
  const socket = getSocket();
  return useSyncExternalStore(
    (onChange) => {
      socket.on('connect', onChange);
      socket.on('disconnect', onChange);
      socket.io.on('reconnect', onChange);
      return () => {
        socket.off('connect', onChange);
        socket.off('disconnect', onChange);
        socket.io.off('reconnect', onChange);
      };
    },
    () => socket.connected,
  );
}
