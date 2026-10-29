import type { SessionStatus } from '@argus/shared';

export interface AskInput {
  prevStatus: SessionStatus | undefined;
  status: SessionStatus;
  /** This window owns (renders) the session — the same rule as delivery. */
  owned: boolean;
  notificationsEnabled: boolean;
  notifAskedAt: number;
  isMainWindow: boolean;
  /** The Electron notification bridge exists (not a browser / mobile surface). */
  bridgeAvailable: boolean;
  /** A sheet or the intro is up: don't ask over it; the next transition will. */
  blocked: boolean;
}

/**
 * Ask about notifications at the moment they would first have helped: an owned
 * session moving into `waiting` from a known previous status (a first sighting
 * is not a transition — the same rule `useNotifications` uses), while they are
 * off and the user was never asked. Deliberately independent of "Show tips": a
 * permission is not a tip, and tips off must not silently mean never notified.
 */
export function shouldAskNotifications(i: AskInput): boolean {
  return i.status === 'waiting'
    && i.prevStatus !== undefined
    && i.prevStatus !== 'waiting'
    && i.owned
    && !i.notificationsEnabled
    && i.notifAskedAt === 0
    && i.isMainWindow
    && i.bridgeAvailable
    && !i.blocked;
}

export const ASK_COPY = {
  title: 'Get a nudge when a session needs you',
  body: 'Argus can show a macOS notification when a session is waiting for input and Argus is in the background. Nothing is sent anywhere.',
  turnOn: 'Turn on notifications',
  notNow: 'Not now',
  confirmSubtitle: 'Notifications on',
  confirmBody: 'You’ll hear from Argus when a session needs you.',
  followup: 'Nothing appeared? Allow Argus in System Settings → Notifications.',
  openSettings: 'Open System Settings',
} as const;

/** How long the "Nothing appeared?" follow-up stays after turning them on. */
export const FOLLOWUP_MS = 8000;
