import type { DiscoveryState, NgrokStatus } from '@argus/shared';
import { hasUsed } from './discoveryState.js';

/**
 * The getting-started checklist for brand-new users: four things that make
 * Argus worth it, each ticked by the real event, never by clicking a box.
 * Started by the Welcome intro (`checklistStartedAt`); upgrading users never
 * see it unless they open it themselves (palette / openChecklist).
 */
export const CHECKLIST_ITEMS = [
  { id: 'two-sessions', label: 'Run two sessions side by side', action: 'Start one' },
  { id: 'inbox', label: 'Answer from the Waiting inbox', action: 'Open' },
  { id: 'notifications', label: 'Turn on notifications', action: 'Settings' },
  { id: 'remote', label: 'Check in from your phone', action: 'Set up' },
] as const;

export type ChecklistId = (typeof CHECKLIST_ITEMS)[number]['id'];

export interface ChecklistSignals {
  liveCount: number;
  discovery: DiscoveryState;
  notificationsEnabled: boolean;
  tunnelStatus: NgrokStatus['tunnelStatus'] | undefined;
}

/** Items the user has done, by observation. Sticky: once ticked (in
 *  `checklistDone`) an item stays ticked even if the signal goes away. */
export function autoDone({ liveCount, discovery, notificationsEnabled, tunnelStatus }: ChecklistSignals): ChecklistId[] {
  const now: ChecklistId[] = [];
  if (liveCount >= 2) now.push('two-sessions');
  if (hasUsed(discovery, 'inbox')) now.push('inbox');
  if (notificationsEnabled) now.push('notifications');
  if (tunnelStatus === 'connected') now.push('remote');
  return CHECKLIST_ITEMS.map((i) => i.id).filter((id) => now.includes(id) || discovery.checklistDone.includes(id));
}

/** New ticks to persist, or null when nothing changed (so no write loop). */
export function newlyDone(signals: ChecklistSignals): string[] | null {
  const done = autoDone(signals);
  const before = signals.discovery.checklistDone;
  return done.some((id) => !before.includes(id)) ? [...new Set([...before, ...done])] : null;
}

export function allDone(discovery: DiscoveryState): boolean {
  return CHECKLIST_ITEMS.every((i) => discovery.checklistDone.includes(i.id));
}

/** Started, not dismissed, not finished. */
export function checklistVisible(discovery: DiscoveryState): boolean {
  return discovery.checklistStartedAt > 0 && !discovery.checklistDismissed && !allDone(discovery);
}

/** openChecklist(): start it if it never was, and bring it back if hidden. */
export function openChecklistState(d: DiscoveryState, now: number): DiscoveryState {
  return { ...d, checklistStartedAt: d.checklistStartedAt || now, checklistDismissed: false };
}
