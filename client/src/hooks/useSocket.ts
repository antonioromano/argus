import { useEffect, useRef, useSyncExternalStore } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { getToken } from '../services/api.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let sharedSocket: TypedSocket | null = null;

function getSocket(): TypedSocket {
  if (!sharedSocket) {
    const token = getToken();
    sharedSocket = io({
      transports: ['websocket', 'polling'],
      auth: token ? { token } : undefined,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
    });

    // Debug logging for socket lifecycle
    sharedSocket.on('connect', () => {
      console.log('[socket] connected, id:', sharedSocket!.id);
    });
    sharedSocket.on('disconnect', (reason) => {
      console.log('[socket] disconnected, reason:', reason);
    });
    sharedSocket.on('connect_error', (err) => {
      console.error('[socket] connect_error:', err.message);
    });
    sharedSocket.io.on('reconnect_attempt', (attempt) => {
      console.log('[socket] reconnect_attempt #', attempt);
    });
    sharedSocket.io.on('reconnect', (attempt) => {
      console.log('[socket] reconnected after', attempt, 'attempts');
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
  const socketRef = useRef<TypedSocket>(getSocket());

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket.connected) {
      socket.connect();
    }
  }, []);

  return socketRef.current;
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
