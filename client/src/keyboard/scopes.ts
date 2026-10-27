import type { ShortcutActionId, ShortcutScope } from './registry.js';

/**
 * Handlers for scoped shortcuts, registered by the component that owns the scope
 * (the open ExplorerWorkbench registers 'explorer'). The app-wide keydown handler
 * matches scoped actions only while their scope is registered, and runs the
 * owner's handler instead of its own switch.
 */
export type ScopeHandlers = Partial<Record<ShortcutActionId, () => void>>;

const active = new Map<ShortcutScope, ScopeHandlers>();

/** Activate `scope` with its handlers; returns the matching unregister. */
export function registerScope(scope: ShortcutScope, handlers: ScopeHandlers): () => void {
  active.set(scope, handlers);
  return () => {
    if (active.get(scope) === handlers) active.delete(scope);
  };
}

export function activeScopes(): Set<ShortcutScope> {
  return new Set(active.keys());
}

/** The registered handler for `id` in any active scope, else null. */
export function scopedHandler(id: ShortcutActionId): (() => void) | null {
  for (const handlers of active.values()) {
    const h = handlers[id];
    if (h) return h;
  }
  return null;
}

/**
 * The app-menu accelerator can deliver a keystroke the renderer already handled
 * (both paths fire for one press). When a scoped action claims a keystroke, the
 * menu event that echoes it is dropped; a menu event with no recent claim (a mouse
 * click on the item, or a key the renderer never saw) still runs.
 */
export function createMenuEchoGuard(windowMs = 300, now: () => number = () => performance.now()) {
  let claimedAt = -Infinity;
  return {
    claim: () => { claimedAt = now(); },
    isEcho: () => now() - claimedAt < windowMs,
  };
}
