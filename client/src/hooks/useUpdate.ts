import { useState, useEffect } from 'react';
import type { UpdateStatus } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { api } from '../services/api.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function useUpdate(socket: TypedSocket) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    api.checkUpdate().then(setStatus).catch(console.error);
  }, []);

  useEffect(() => {
    const handleUpdate = (newStatus: UpdateStatus) => setStatus(newStatus);
    socket.on('update:available', handleUpdate);
    return () => { socket.off('update:available', handleUpdate); };
  }, [socket]);

  return { status };
}
