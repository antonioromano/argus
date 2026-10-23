import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { ChatUpdate, ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { EMPTY_CHAT, applyChatUpdate, type ChatState } from '../utils/chat.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Chat view messages of one Claude session (B1). Subscribes while `enabled`
 * (the server reads the transcript for chat only while someone does) and
 * again after a reconnect, since the server drops a dropped socket's feeds.
 */
export function useChat(socket: TypedSocket, sessionId: string, enabled: boolean): ChatState {
  const [state, setState] = useState<{ sessionId: string; chat: ChatState }>({ sessionId, chat: EMPTY_CHAT });

  useEffect(() => {
    if (!enabled) return;
    // The first update after (re)subscribing is a reset, so stale state is replaced.
    const onChat = (update: ChatUpdate) => {
      if (update.sessionId !== sessionId) return;
      setState((prev) => ({ sessionId, chat: applyChatUpdate(prev.sessionId === sessionId ? prev.chat : EMPTY_CHAT, update) }));
    };
    const subscribe = () => socket.emit('session:chat:subscribe', sessionId);
    socket.on('session:chat', onChat);
    socket.on('connect', subscribe);
    if (socket.connected) subscribe();
    return () => {
      socket.off('session:chat', onChat);
      socket.off('connect', subscribe);
      socket.emit('session:chat:unsubscribe', sessionId);
    };
  }, [socket, sessionId, enabled]);

  return state.sessionId === sessionId ? state.chat : EMPTY_CHAT;
}
