import { useState, useEffect, useCallback, useRef } from 'react';
import type { SessionInfo } from '@argus/shared';

interface OrderApi {
  load: () => Promise<string[]>;
  save: (order: string[]) => Promise<void>;
}

/**
 * Generic persisted ordering of session ids. Loads on mount, applies the order to a
 * session list (unknown ids appended at the end), and persists reorders with a 300ms debounce.
 * Backed by whatever load/save pair is passed in — used by both the global session order and
 * the mosaic-only order.
 */
export function useOrder({ load, save }: OrderApi) {
  const [order, setOrder] = useState<string[]>([]);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    load().then(setOrder).catch(console.error);
  }, [load]);

  const persistOrder = useCallback((newOrder: string[]) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      save(newOrder).catch(console.error);
    }, 300);
  }, [save]);

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
