import { useState, useEffect, useCallback, useRef } from 'react';
import type { SessionInfo } from '@argus/shared';
import { api } from '../services/api.js';

export function useSessionOrder() {
  const [order, setOrder] = useState<string[]>([]);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    api.getSessionOrder().then(setOrder).catch(console.error);
  }, []);

  const persistOrder = useCallback((newOrder: string[]) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      api.saveSessionOrder(newOrder).catch(console.error);
    }, 300);
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  const getOrderedSessions = useCallback(
    (sessions: SessionInfo[]): SessionInfo[] => {
      const sessionMap = new Map(sessions.map((s) => [s.id, s]));
      const ordered: SessionInfo[] = [];

      for (const id of order) {
        const session = sessionMap.get(id);
        if (session) {
          ordered.push(session);
          sessionMap.delete(id);
        }
      }

      for (const session of sessionMap.values()) {
        ordered.push(session);
      }

      return ordered;
    },
    [order],
  );

  const reorder = useCallback(
    (newOrder: string[]) => {
      setOrder(newOrder);
      persistOrder(newOrder);
    },
    [persistOrder],
  );

  return { order, getOrderedSessions, reorder };
}
