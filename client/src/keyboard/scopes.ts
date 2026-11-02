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

/**
 * For a toggle reachable both from the renderer keydown handler and from its
 * app-menu accelerator (⌘K Find & Jump, ⌘⇧L theme). One keystroke can reach
 * both paths, in either order, and two toggles cancel out. Whichever arrives
 * first runs; the other within `windowMs` is dropped. A lone mouse click on the
 * menu item has no partner and always runs.
 */
export function createDedupeGate(windowMs = 300, now: () => number = () => performance.now()) {
  const guard = createMenuEchoGuard(windowMs, now);
  return {
    /** Runs `fn` unless the other path ran it within the window; true when it ran. */
    run(fn: () => void): boolean {
      if (guard.isEcho()) return false;
      guard.claim();
      fn();
      return true;
    },
  };
}

export type MenuEchoGuard = ReturnType<typeof createMenuEchoGuard>;
export type DedupeGate = ReturnType<typeof createDedupeGate>;
