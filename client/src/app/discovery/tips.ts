import type { DiscoveryState, SessionInfo } from '@argus/shared';
import type { ShortcutActionId } from '../../keyboard/registry.js';
import type { DiscoveryEvent } from './discoveryEvents.js';
import { hasUsed, type UsedMarker } from './discoveryState.js';

/**
 * The tip catalogue: pure data plus a pure trigger per tip. A tip shows the
 * first time its feature would help, never again, and never once the user has
 * found the feature on their own (`suppressedBy`). Order = priority: the most
 * urgent first.
 */
export type TipId = 'waiting-inbox' | 'worktrees' | 'broadcast' | 'session-search';

/** What the primary button does; ArgusApp maps each to the real opener. */
export type TipAction = 'inbox' | 'broadcast' | 'search' | 'isolation-settings';

export interface TipContext {
  /** Sessions this window owns that have not exited. */
  sessions: readonly Pick<SessionInfo, 'id' | 'status' | 'folderPath'>[];
  /** The discovery event that triggered this evaluation, if any. */
  lastEvent?: DiscoveryEvent;
}

export interface TipDef {
  id: TipId;
  suppressedBy: UsedMarker;
  /** Rendered live from the user's binding, so a rebind can't leave a stale combo. */
  shortcut?: ShortcutActionId;
  title: string;
  body: string;
  primaryLabel: string;
  action: TipAction;
  fires(ctx: TipContext): boolean;
}

export const TIPS: readonly TipDef[] = [
  {
    id: 'waiting-inbox',
    suppressedBy: 'inbox',
    shortcut: 'waiting-inbox',
    title: 'Several sessions need you',
    body: 'The Waiting inbox lists every waiting session, and you can answer each one from there.',
    primaryLabel: 'Open the inbox',
    action: 'inbox',
    fires: ({ sessions }) => sessions.filter((s) => s.status === 'waiting').length >= 3,
  },
  {
    id: 'worktrees',
    suppressedBy: 'worktree',
    title: 'Two agents, one checkout',
    body: 'Start the next session in a worktree so their edits don’t collide.',
    primaryLabel: 'Show worktree settings',
    action: 'isolation-settings',
    fires: ({ sessions, lastEvent }) =>
      lastEvent?.type === 'create'
      && lastEvent.gitRepo
      && !lastEvent.worktree
      && sessions.filter((s) => s.folderPath === lastEvent.folderPath).length >= 2,
  },
  {
    id: 'broadcast',
    suppressedBy: 'broadcast',
    title: 'Same prompt, several sessions',
    body: 'Broadcast sends one prompt to every session you pick.',
    primaryLabel: 'Try broadcast',
    action: 'broadcast',
    fires: ({ sessions }) => sessions.length >= 2,
  },
  {
    id: 'session-search',
    suppressedBy: 'session-search',
    shortcut: 'session-search',
    title: 'Looking for something?',
    body: 'Search every session’s scrollback and transcripts at once. ⌘F searches just this one.',
    primaryLabel: 'Search sessions',
    action: 'search',
    fires: ({ lastEvent }) => lastEvent?.type === 'deep-scroll',
  },
];

/** The first tip that fires, has not been shown, and teaches something new. */
export function nextTip(defs: readonly TipDef[], ctx: TipContext, state: DiscoveryState): TipDef | null {
  for (const t of defs) {
    if (state.tipsSeen.includes(t.id)) continue;
    if (hasUsed(state, t.suppressedBy)) continue;
    if (t.fires(ctx)) return t;
  }
  return null;
}

export function tipById(id: string): TipDef | undefined {
  return TIPS.find((t) => t.id === id);
}
