import { useEffect, useRef } from 'react';
import type { SessionInfo } from '@argus/shared';

/**
 * Mobile-browser notifications on a shell entering `waiting` (needs input) or
 * `done` (finished a run). Uses the web Notification API (the Electron
 * `useNotifications` hook relies on a desktop bridge that does not exist in a
 * phone browser). Best-effort: silently no-ops where the API or permission is
 * unavailable.
 */
export function useWaitingNotifications(sessions: SessionInfo[], enabled: boolean, notifyDone = false) {
  const prev = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const granted =
      typeof Notification !== 'undefined' && Notification.permission === 'granted';
    const canNotify = enabled && granted;
    const canNotifyDone = notifyDone && granted;

    for (const s of sessions) {
      const was = prev.current.get(s.id);
      if (canNotify && s.status === 'waiting' && was !== 'waiting' && was !== undefined && document.hidden) {
        const folder = s.folderPath.split('/').filter(Boolean).pop() || s.folderPath;
        try {
          new Notification(s.name, { body: s.lastPrompt || folder, tag: s.id });
        } catch { /* ignore */ }
      }
      if (canNotifyDone && s.status === 'done' && was !== 'done' && was !== undefined && document.hidden) {
        try {
          new Notification(s.name, { body: `${s.name} finished`, tag: s.id });
        } catch { /* ignore */ }
      }
      prev.current.set(s.id, s.status);
    }

    // Forget removed sessions.
    const live = new Set(sessions.map((s) => s.id));
    for (const id of prev.current.keys()) if (!live.has(id)) prev.current.delete(id);
  }, [sessions, enabled, notifyDone]);
}
