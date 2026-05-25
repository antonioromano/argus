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
  const activeNotifs = useRef<Map<string, Notification>>(new Map());
  const prevStatuses = useRef<Map<string, string>>(new Map());
  const onFocusRef = useRef(onFocusSession);
  const onSwitchRef = useRef(onSwitchToSessionsTab);

  useEffect(() => {
    onFocusRef.current = onFocusSession;
    onSwitchRef.current = onSwitchToSessionsTab;
  }, [onFocusSession, onSwitchToSessionsTab]);

  const fireNotification = (session: SessionInfo) => {
    if (activeNotifs.current.has(session.id)) return;

    const folderName = session.folderPath.split('/').pop() || session.folderPath;
    const notif = new Notification(session.name, {
      body: folderName,
      tag: `session-${session.id}`,
    });

    notif.onclick = () => {
      window.focus();
      onSwitchRef.current();
      onFocusRef.current(session.id);
      notif.close();
      activeNotifs.current.delete(session.id);
    };

    activeNotifs.current.set(session.id, notif);
  };

  // Fire notifications on status transitions
  useEffect(() => {
    if (!enabled || !('Notification' in window) || Notification.permission !== 'granted') {
      for (const session of sessions) {
        prevStatuses.current.set(session.id, session.status);
      }
      return;
    }

    for (const session of sessions) {
      const prev = prevStatuses.current.get(session.id);
      const curr = session.status;

      // Transition TO waiting — only notify if tab is not focused
      if (curr === 'waiting' && prev !== 'waiting' && prev !== undefined) {
        if (!document.hasFocus()) {
          fireNotification(session);
        }
      }

      // Transition AWAY from waiting — clean up
      if (curr !== 'waiting' && prev === 'waiting') {
        const existing = activeNotifs.current.get(session.id);
        if (existing) {
          existing.close();
          activeNotifs.current.delete(session.id);
        }
      }

      prevStatuses.current.set(session.id, curr);
    }

    // Close notifications for deleted sessions
    const currentIds = new Set(sessions.map((s) => s.id));
    for (const [id, notif] of activeNotifs.current) {
      if (!currentIds.has(id)) {
        notif.close();
        activeNotifs.current.delete(id);
        prevStatuses.current.delete(id);
      }
    }
  }, [sessions, enabled]);

  // Cleanup on unmount
  useEffect(() => {
    const notifs = activeNotifs.current;
    return () => {
      notifs.forEach((n) => n.close());
      notifs.clear();
    };
  }, []);
}
