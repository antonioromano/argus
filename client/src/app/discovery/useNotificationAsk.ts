import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppConfig, SessionInfo, SessionStatus } from '@argus/shared';
import { ASK_COPY, FOLLOWUP_MS, shouldAskNotifications } from './notificationAsk.js';
import type { DiscoveryApi } from './useDiscovery.js';

export type AskPhase = 'ask' | 'followup' | null;

export interface UseNotificationAskArgs {
  sessions: readonly Pick<SessionInfo, 'id' | 'status'>[];
  ownsSession: (id: string) => boolean;
  notificationsEnabled: boolean;
  disc: DiscoveryApi;
  isMainWindow: boolean;
  blocked: boolean;
  updateConfig: (patch: Partial<AppConfig>) => Promise<AppConfig>;
  now?: () => number;
}

export interface NotificationAskApi {
  phase: AskPhase;
  turnOn: () => Promise<void>;
  /** "Not now" or ✕ on the ask, or closing the follow-up. Asked is asked. */
  close: () => void;
  openSystemSettings: () => void;
}

/**
 * The notification permission ask. Keeps its own previous-status map rather
 * than adding UI concerns to `useNotifications`, which stays delivery-only.
 * Stamps `notifAskedAt` (never again) and `tipLastShownAt` (no tip right after)
 * at show time.
 */
export function useNotificationAsk(args: UseNotificationAskArgs): NotificationAskApi {
  const [phase, setPhase] = useState<AskPhase>(null);
  const prev = useRef(new Map<string, SessionStatus>());
  const live = useRef(args);
  useEffect(() => { live.current = args; });

  useEffect(() => {
    const a = live.current;
    const bridgeAvailable = typeof window !== 'undefined' && !!window.electronNotifications;
    let ask = false;
    for (const s of args.sessions) {
      if (!ask && shouldAskNotifications({
        prevStatus: prev.current.get(s.id),
        status: s.status,
        owned: a.ownsSession(s.id),
        notificationsEnabled: a.notificationsEnabled,
        notifAskedAt: a.disc.discovery.notifAskedAt,
        isMainWindow: a.isMainWindow,
        bridgeAvailable,
        blocked: a.blocked,
      })) ask = true;
      prev.current.set(s.id, s.status);
    }
    if (!ask) return;
    const at = (a.now ?? Date.now)();
    // A status transition is an external event seen only through props; the
    // ask is a one-shot reaction to it, not state derivable during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase('ask');
    void a.disc.patch((d) => ({ ...d, notifAskedAt: at, tipLastShownAt: at }));
  }, [args.sessions]);

  // The follow-up is a short-lived hint, not a standing banner.
  useEffect(() => {
    if (phase !== 'followup') return;
    const t = setTimeout(() => setPhase(null), FOLLOWUP_MS);
    return () => clearTimeout(t);
  }, [phase]);

  const turnOn = useCallback(async () => {
    setPhase('followup');
    await live.current.updateConfig({ notificationsEnabled: true });
    // The first delivery is what makes macOS show its permission prompt — now,
    // at a moment the user chose, instead of during some later background wait.
    // No attributeToApp: Argus is frontmost, where an Argus-attributed banner
    // would be suppressed (same as Settings' test button).
    window.electronNotifications?.show({
      id: crypto.randomUUID(),
      title: 'Argus',
      subtitle: ASK_COPY.confirmSubtitle,
      body: ASK_COPY.confirmBody,
    });
  }, []);

  const close = useCallback(() => setPhase(null), []);

  const openSystemSettings = useCallback(() => {
    window.electronNotifications?.openSystemSettings?.('notifications');
  }, []);

  return { phase, turnOn, close, openSystemSettings };
}
