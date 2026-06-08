import { useMemo } from 'react';
import { comboMatches, normalizeCombo } from './combo.js';
import { SHORTCUTS, type ShortcutActionId } from './registry.js';

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

/** First action (in registry order) whose resolved combo matches the event, else null. */
export function matchEvent(e: KeyboardEvent, resolved: ResolvedShortcuts): ShortcutActionId | null {
  for (const a of SHORTCUTS) {
    if (comboMatches(e, resolved[a.id])) return a.id;
  }
  return null;
}

/** Action ids that resolve to the same combo as another action (for conflict warnings). */
export function findConflicts(resolved: ResolvedShortcuts): Set<ShortcutActionId> {
  const seen = new Map<string, ShortcutActionId>();
  const conflicting = new Set<ShortcutActionId>();
  for (const a of SHORTCUTS) {
    const combo = resolved[a.id];
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
  match: (e: KeyboardEvent) => ShortcutActionId | null;
  comboFor: (id: ShortcutActionId) => string;
  conflicts: Set<ShortcutActionId>;
}

/** Reactive resolver derived from AppConfig.keyboardShortcuts. Pure given the overrides arg. */
export function useShortcuts(overrides?: Record<string, string>): ShortcutsApi {
  return useMemo(() => {
    const resolved = resolveShortcuts(overrides);
    return {
      resolved,
      match: (e: KeyboardEvent) => matchEvent(e, resolved),
      comboFor: (id: ShortcutActionId) => resolved[id],
      conflicts: findConflicts(resolved),
    };
  }, [overrides]);
}
