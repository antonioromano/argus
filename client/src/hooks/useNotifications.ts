import { useEffect, useRef } from 'react';
import type { SessionInfo, SessionPr } from '@argus/shared';
import { ciSummary, prRef } from '../utils/prFormat.js';

interface UseNotificationsOptions {
  sessions: SessionInfo[];
  enabled: boolean;
  /** Notify when a session needs user input (status → waiting). */
  notifyOnWaiting?: boolean;
  /** Notify when a session finishes a run (status → done). */
  notifyOnDone?: boolean;
  /** C1: notify when a session PR's checks finish (pending → success / failure). */
  notifyOnPrChecks?: boolean;
  /** Play the macOS default system sound with each notification. */
  notificationSound?: boolean;
  onFocusSession: (id: string) => void;
  onSwitchToSessionsTab: () => void;
  /**
   * Whether this window owns the session (windows.json; unowned → main).
   * Every Electron window runs this hook over ALL sessions, gated only on its
   * own document.hasFocus(), so without this a background window notified about
   * a session the user was watching in its focused owner window (and two
   * unfocused windows both posted for the same transition). Only the owner —
   * the one window that renders the session — decides. Defaults to "all mine"
   * (single window).
   */
  ownsSession?: (id: string) => boolean;
}

const OWNS_ALL = () => true;

/** C1: the checks outcome a notification is about — one per PR, head commit
 *  and outcome, so sessions sharing a PR, several windows or a re-render never
 *  post it twice, while a new push (or a re-run that flips the result) does. */
const ciOutcomeKey = (pr: SessionPr): string => `${pr.url.toLowerCase()}@${pr.headSha ?? ''}:${pr.ci}`;
const CI_NOTIFIED_MAX = 200;

export function useNotifications({
  sessions,
  enabled,
  notifyOnWaiting = true,
  notifyOnDone = false,
  notifyOnPrChecks = true,
  notificationSound = false,
  onFocusSession,
  onSwitchToSessionsTab,
  ownsSession = OWNS_ALL,
}: UseNotificationsOptions) {
  // Active notifications: id → whether the body was the generic fallback
  // (no extracted prompt yet). Fallback bodies are upgraded once when the
  // real question arrives via a later session:status re-emit — re-show with
  // the same id silently replaces (terminal-notifier -group / dev close()).
  const activeIds = useRef<Map<string, { usedFallback: boolean }>>(new Map());
  const prevStatuses = useRef<Map<string, string>>(new Map());
  // C1: each session's last PR chip reading, and the checks outcomes already posted.
  const prevPrs = useRef<Map<string, SessionPr | null>>(new Map());
  const ciNotified = useRef<Set<string>>(new Set());
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
        prevPrs.current.set(session.id, session.pr ?? null);
      }
      return;
    }

    for (const session of sessions) {
      const prev = prevStatuses.current.get(session.id);
      const curr = session.status;
      const mine = ownsSession(session.id);

      if (mine && curr === 'waiting' && prev !== 'waiting' && prev !== undefined && notifyOnWaiting) {
        if (!document.hasFocus() && !activeIds.current.has(session.id)) {
          // terminal-notifier 2.0.0 drops -message bodies starting with '[',
          // so session name goes in subtitle, body is the message text only.
          const body = session.lastPrompt ?? 'Waiting for your input';
          bridge.show({ id: session.id, title: 'Argus', subtitle: session.name, body, sound: notificationSound, attributeToApp: true });
          activeIds.current.set(session.id, { usedFallback: session.lastPrompt == null });
        }
      }

      // Upgrade a fallback body once the real question text arrives (the
      // server re-extracts on later repaints while still waiting).
      if (curr === 'waiting' && session.lastPrompt != null) {
        const active = activeIds.current.get(session.id);
        if (active?.usedFallback) {
          bridge.show({ id: session.id, title: 'Argus', subtitle: session.name, body: session.lastPrompt, sound: notificationSound, attributeToApp: true });
          activeIds.current.set(session.id, { usedFallback: false });
        }
      }

      if (mine && curr === 'done' && prev !== 'done' && prev !== undefined && notifyOnDone) {
        if (!document.hasFocus() && !activeIds.current.has(session.id)) {
          bridge.show({ id: session.id, title: 'Argus', subtitle: session.name, body: 'Finished', sound: notificationSound, attributeToApp: true });
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

      // C1: the PR chip's checks finished. Only a pending → done transition of
      // the same PR counts (not the first reading, not a PR swap). Skipped
      // while a waiting / done banner is up for the session: one id per
      // session, and the input request is the more urgent of the two.
      const pr = session.pr ?? null;
      const prevPr = prevPrs.current.get(session.id);
      prevPrs.current.set(session.id, pr);
      if (
        mine && notifyOnPrChecks && pr && prevPr && prevPr.url === pr.url
        && prevPr.ci === 'pending' && (pr.ci === 'success' || pr.ci === 'failure')
        && !document.hasFocus() && !activeIds.current.has(session.id)
      ) {
        const key = ciOutcomeKey(pr);
        if (!ciNotified.current.has(key)) {
          ciNotified.current.add(key);
          if (ciNotified.current.size > CI_NOTIFIED_MAX) ciNotified.current.delete(ciNotified.current.values().next().value as string);
          const body = `${ciSummary(pr)} · ${prRef(pr.url, pr.number)}`;
          bridge.show({ id: session.id, title: 'Argus', subtitle: session.name, body, sound: notificationSound, attributeToApp: true });
        }
      }
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
    for (const id of prevPrs.current.keys()) {
      if (!currentIds.has(id)) prevPrs.current.delete(id);
    }
  }, [sessions, enabled, notifyOnWaiting, notifyOnDone, notifyOnPrChecks, notificationSound, ownsSession]);

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
