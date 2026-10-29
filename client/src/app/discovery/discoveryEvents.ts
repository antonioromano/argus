import type { UsedMarker } from './discoveryState.js';

/**
 * Signals the session list can't show: a feature was opened, a session was
 * created, a terminal was scrolled deep. Feature code emits and stays ignorant
 * of tips and the checklist; the discovery layer subscribes. Module-level, like
 * pushToast's external push — there is one renderer per window.
 */
export type DiscoveryEvent =
  | { type: 'used'; marker: UsedMarker }
  | { type: 'create'; gitRepo: boolean; worktree: boolean; folderPath: string }
  | { type: 'deep-scroll'; sessionId: string };

type Listener = (e: DiscoveryEvent) => void;

const listeners = new Set<Listener>();

export function emitDiscovery(e: DiscoveryEvent): void {
  for (const fn of [...listeners]) {
    try {
      fn(e);
    } catch (err) {
      // One broken listener must not starve the others.
      console.error('[discovery] listener failed', err);
    }
  }
}

export function onDiscovery(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
