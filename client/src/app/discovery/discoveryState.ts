import type { DiscoveryState } from '@argus/shared';

/**
 * Pure helpers over `AppConfig.discovery` — what the contextual-discovery layer
 * (tips, notification ask, beta promos, getting-started checklist) has already
 * shown or seen the user do. Every write goes through one of these and is saved
 * whole (see useDiscovery), so a field can never be dropped by a partial patch.
 */

/** Features the user can reach on their own; a tip for one is never shown after. */
export type UsedMarker = 'inbox' | 'broadcast' | 'session-search' | 'worktree' | 'session-menu';

/** At most this many tips per app launch… */
export const TIPS_PER_LAUNCH = 1;
/** …and none within this long of the last one, across launches. */
export const TIP_MIN_GAP_MS = 60 * 60_000;

export const EMPTY_DISCOVERY: DiscoveryState = {
  tipsSeen: [],
  tipLastShownAt: 0,
  notifAskedAt: 0,
  used: [],
  checklistStartedAt: 0,
  checklistDone: [],
  checklistDismissed: false,
  betaPromosHidden: [],
};

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const time = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;

/** Fill in what an older build (or a hand-edited file) left out. The server's
 *  merge is shallow, so a partial object comes back partial. */
export function normalizeDiscovery(raw: unknown): DiscoveryState {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...EMPTY_DISCOVERY };
  const r = raw as Record<string, unknown>;
  return {
    tipsSeen: strings(r.tipsSeen),
    tipLastShownAt: time(r.tipLastShownAt),
    notifAskedAt: time(r.notifAskedAt),
    used: strings(r.used),
    checklistStartedAt: time(r.checklistStartedAt),
    checklistDone: strings(r.checklistDone),
    checklistDismissed: r.checklistDismissed === true,
    betaPromosHidden: strings(r.betaPromosHidden),
  };
}

export function markTipSeen(s: DiscoveryState, id: string, now: number): DiscoveryState {
  return {
    ...s,
    tipsSeen: s.tipsSeen.includes(id) ? s.tipsSeen : [...s.tipsSeen, id],
    tipLastShownAt: now,
  };
}

export function markUsed(s: DiscoveryState, marker: UsedMarker): DiscoveryState {
  return s.used.includes(marker) ? s : { ...s, used: [...s.used, marker] };
}

export function hasUsed(s: DiscoveryState, marker: UsedMarker): boolean {
  return s.used.includes(marker);
}

/** "Show tips again": forget which tips were shown and when; keep the rest. */
export function resetTips(s: DiscoveryState): DiscoveryState {
  return { ...s, tipsSeen: [], tipLastShownAt: 0 };
}

/** The rate limit and the global switch, in one place. */
export function tipAllowed(
  s: DiscoveryState,
  { now, shownThisLaunch, showTips }: { now: number; shownThisLaunch: number; showTips: boolean },
): boolean {
  if (!showTips) return false;
  if (shownThisLaunch >= TIPS_PER_LAUNCH) return false;
  return now - s.tipLastShownAt >= TIP_MIN_GAP_MS;
}

/** Structural equality, so an idempotent update skips the network write. */
export function sameDiscovery(a: DiscoveryState, b: DiscoveryState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
