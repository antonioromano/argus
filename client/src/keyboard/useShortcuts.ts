import { useMemo } from 'react';
import { comboMatches, normalizeCombo } from './combo.js';
import { SHORTCUTS, scopeOf, type ShortcutActionId, type ShortcutScope } from './registry.js';

export type ResolvedShortcuts = Record<ShortcutActionId, string>;

/** Merge user overrides over registry defaults. Fixed actions ignore overrides. */
export function resolveShortcuts(overrides?: Record<string, string>): ResolvedShortcuts {
  const out = {} as ResolvedShortcuts;
  for (const a of SHORTCUTS) {
    if (a.fixed) {
      out[a.id] = a.defaultCombo;
      continue;
    }
    const raw = overrides?.[a.id];
    const normalized = raw ? normalizeCombo(raw) : '';
    out[a.id] = normalized || a.defaultCombo;
  }
  return out;
}

/** The action whose resolved combo matches the event, else null. Actions of an active
 *  scope (see keyboard/scopes) win over global ones; inactive scoped actions never match. */
export function matchEvent(
  e: KeyboardEvent,
  resolved: ResolvedShortcuts,
  scopes: ReadonlySet<ShortcutScope> = new Set(),
): ShortcutActionId | null {
  for (const a of SHORTCUTS) {
    const scope = scopeOf(a);
    if (scope !== 'global' && scopes.has(scope) && comboMatches(e, resolved[a.id])) return a.id;
  }
  for (const a of SHORTCUTS) {
    if (scopeOf(a) === 'global' && comboMatches(e, resolved[a.id])) return a.id;
  }
  return null;
}

/** Action ids that resolve to the same combo as another action in the same scope (for
 *  conflict warnings). A scoped action shadowing a global one is intended, not a conflict. */
export function findConflicts(resolved: ResolvedShortcuts): Set<ShortcutActionId> {
  const seen = new Map<string, ShortcutActionId>();
  const conflicting = new Set<ShortcutActionId>();
  for (const a of SHORTCUTS) {
    const combo = `${scopeOf(a)}:${resolved[a.id]}`;
    const prev = seen.get(combo);
    if (prev) {
      conflicting.add(prev);
      conflicting.add(a.id);
    } else {
      seen.set(combo, a.id);
    }
  }
  return conflicting;
}

export interface ShortcutsApi {
  resolved: ResolvedShortcuts;
  match: (e: KeyboardEvent, scopes?: ReadonlySet<ShortcutScope>) => ShortcutActionId | null;
  comboFor: (id: ShortcutActionId) => string;
  conflicts: Set<ShortcutActionId>;
}

/** Reactive resolver derived from AppConfig.keyboardShortcuts. Pure given the overrides arg. */
export function useShortcuts(overrides?: Record<string, string>): ShortcutsApi {
  return useMemo(() => {
    const resolved = resolveShortcuts(overrides);
    return {
      resolved,
      match: (e: KeyboardEvent, scopes?: ReadonlySet<ShortcutScope>) => matchEvent(e, resolved, scopes),
      comboFor: (id: ShortcutActionId) => resolved[id],
      conflicts: findConflicts(resolved),
    };
  }, [overrides]);
}
