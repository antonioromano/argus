import { useEffect, useRef } from 'react';
import type { SessionInfo } from '@argus/shared';

interface UseNotificationsOptions {
  sessions: SessionInfo[];
  enabled: boolean;
  /** Notify when a session needs user input (status → waiting). */
  notifyOnWaiting?: boolean;
  /** Notify when a session finishes a run (status → done). */
  notifyOnDone?: boolean;
  /** Play the macOS default system sound with each notification. */
  notificationSound?: boolean;
  onFocusSession: (id: string) => void;
  onSwitchToSessionsTab: () => void;
}

export function useNotifications({
  sessions,
  enabled,
  notifyOnWaiting = true,
  notifyOnDone = false,
  notificationSound = false,
  onFocusSession,
  onSwitchToSessionsTab,
}: UseNotificationsOptions) {
  // Active notifications: id → whether the body was the generic fallback
  // (no extracted prompt yet). Fallback bodies are upgraded once when the
  // real question arrives via a later session:status re-emit — re-show with
  // the same id silently replaces (terminal-notifier -group / dev close()).
  const activeIds = useRef<Map<string, { usedFallback: boolean }>>(new Map());
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

      if (curr === 'waiting' && prev !== 'waiting' && prev !== undefined && notifyOnWaiting) {
        if (!document.hasFocus() && !activeIds.current.has(session.id)) {
          // Never a bare session name — when no prompt was extracted, say
          // what the notification means and self-heal below if text arrives.
          const body = session.lastPrompt
            ? `[${session.name}] ${session.lastPrompt}`
            : `[${session.name}] Waiting for your input`;
          bridge.show({ id: session.id, title: 'Argus', body, sound: notificationSound });
          activeIds.current.set(session.id, { usedFallback: session.lastPrompt == null });
        }
      }

      // Upgrade a fallback body once the real question text arrives (the
      // server re-extracts on later repaints while still waiting).
      if (curr === 'waiting' && session.lastPrompt != null) {
        const active = activeIds.current.get(session.id);
        if (active?.usedFallback) {
          bridge.show({ id: session.id, title: 'Argus', body: `[${session.name}] ${session.lastPrompt}`, sound: notificationSound });
          activeIds.current.set(session.id, { usedFallback: false });
        }
      }

      if (curr === 'done' && prev !== 'done' && prev !== undefined && notifyOnDone) {
        if (!document.hasFocus() && !activeIds.current.has(session.id)) {
          bridge.show({ id: session.id, title: 'Argus', body: `[${session.name}] Finished`, sound: notificationSound });
          activeIds.current.set(session.id, { usedFallback: false });
        }
      }

      if (curr !== 'waiting' && curr !== 'done' && (prev === 'waiting' || prev === 'done')) {
        if (activeIds.current.has(session.id)) {
          bridge.close(session.id);
          activeIds.current.delete(session.id);
        }
      }

      prevStatuses.current.set(session.id, curr);
    }

    // Close notifications for deleted sessions
    const currentIds = new Set(sessions.map((s) => s.id));
    for (const id of activeIds.current.keys()) {
      if (!currentIds.has(id)) {
        bridge.close(id);
        activeIds.current.delete(id);
        prevStatuses.current.delete(id);
      }
    }
  }, [sessions, enabled, notifyOnWaiting, notifyOnDone, notificationSound]);

  // Cleanup on unmount
  useEffect(() => {
    const ids = activeIds.current;
    return () => {
      const bridge = window.electronNotifications;
      if (bridge) {
        for (const id of ids.keys()) bridge.close(id);
      }
      ids.clear();
    };
  }, []);
}
