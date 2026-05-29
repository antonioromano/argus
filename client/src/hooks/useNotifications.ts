import { useEffect, useRef } from 'react';
import type { SessionInfo } from '@argus/shared';

interface UseNotificationsOptions {
  sessions: SessionInfo[];
  enabled: boolean;
  onFocusSession: (id: string) => void;
  onSwitchToSessionsTab: () => void;
}

export function useNotifications({
  sessions,
  enabled,
  onFocusSession,
  onSwitchToSessionsTab,
}: UseNotificationsOptions) {
  const activeIds = useRef<Set<string>>(new Set());
  const prevStatuses = useRef<Map<string, string>>(new Map());
  const onFocusRef = useRef(onFocusSession);
  const onSwitchRef = useRef(onSwitchToSessionsTab);

  useEffect(() => {
    onFocusRef.current = onFocusSession;
    onSwitchRef.current = onSwitchToSessionsTab;
  }, [onFocusSession, onSwitchToSessionsTab]);

  // Wire click-handler once: main process forwards notification clicks here.
  useEffect(() => {
    const bridge = window.electronNotifications;
    if (!bridge) return;
    return bridge.onClick((id) => {
      onSwitchRef.current();
      onFocusRef.current(id);
      activeIds.current.delete(id);
    });
  }, []);

  // Fire notifications on status transitions
  useEffect(() => {
    const bridge = window.electronNotifications;
    if (!enabled || !bridge) {
      for (const session of sessions) {
        prevStatuses.current.set(session.id, session.status);
      }
      return;
    }

    for (const session of sessions) {
      const prev = prevStatuses.current.get(session.id);
      const curr = session.status;

      if (curr === 'waiting' && prev !== 'waiting' && prev !== undefined) {
        if (!document.hasFocus() && !activeIds.current.has(session.id)) {
          const folderName = session.folderPath.split('/').pop() || session.folderPath;
          const body = session.lastPrompt
            ? `${folderName} — ${session.lastPrompt}`
            : folderName;
          bridge.show({ id: session.id, title: session.name, body });
          activeIds.current.add(session.id);
        }
      }

      if (curr !== 'waiting' && prev === 'waiting') {
        if (activeIds.current.has(session.id)) {
          bridge.close(session.id);
          activeIds.current.delete(session.id);
        }
      }

      prevStatuses.current.set(session.id, curr);
    }

    // Close notifications for deleted sessions
    const currentIds = new Set(sessions.map((s) => s.id));
    for (const id of activeIds.current) {
      if (!currentIds.has(id)) {
        bridge.close(id);
        activeIds.current.delete(id);
        prevStatuses.current.delete(id);
      }
    }
  }, [sessions, enabled]);

  // Cleanup on unmount
  useEffect(() => {
    const ids = activeIds.current;
    return () => {
      const bridge = window.electronNotifications;
      if (bridge) {
        ids.forEach((id) => bridge.close(id));
      }
      ids.clear();
    };
  }, []);
}
