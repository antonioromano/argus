import { isPrimaryModifier, isMac } from '../utils/platform.js';

/**
 * Keyboard combos are stored as normalized, platform-agnostic strings:
 *   "mod+shift+f"  — "mod" = the primary modifier (Cmd on macOS, Ctrl elsewhere).
 * Supported modifier tokens: mod, alt, shift. Canonical order: mod → alt → shift → key.
 */

const MOD_ORDER = ['mod', 'alt', 'shift'] as const;

/** Lowercase + normalize a KeyboardEvent.key into a stable token. */
function normalizeKey(key: string): string {
  const k = key.toLowerCase();
  if (k === ' ' || k === 'spacebar') return 'space';
  return k;
}

interface ParsedCombo {
  mod: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

export function parseCombo(combo: string): ParsedCombo | null {
  const parts = combo.toLowerCase().split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const out: ParsedCombo = { mod: false, alt: false, shift: false, key: '' };
  for (const p of parts) {
    if (p === 'mod' || p === 'cmd' || p === 'meta' || p === 'ctrl' || p === 'control') out.mod = true;
    else if (p === 'alt' || p === 'option') out.alt = true;
    else if (p === 'shift') out.shift = true;
    else out.key = normalizeKey(p);
  }
  if (!out.key) return null;
  return out;
}

/** Re-serialize a combo string into canonical token order. Returns '' for invalid input. */
export function normalizeCombo(combo: string): string {
  const p = parseCombo(combo);
  if (!p) return '';
  return serialize(p);
}

function serialize(p: ParsedCombo): string {
  const tokens: string[] = [];
  for (const m of MOD_ORDER) {
    if (m === 'mod' && p.mod) tokens.push('mod');
    if (m === 'alt' && p.alt) tokens.push('alt');
    if (m === 'shift' && p.shift) tokens.push('shift');
  }
  tokens.push(p.key);
  return tokens.join('+');
}

/** Build a normalized combo string from a live KeyboardEvent (used by the record-a-binding UI). */
export function eventToCombo(e: KeyboardEvent): string {
  return serialize({
    mod: isPrimaryModifier(e),
    alt: e.altKey,
    shift: e.shiftKey,
    key: normalizeKey(e.key),
  });
}

/** True only when the event matches the combo on key AND every modifier exactly. */
export function comboMatches(e: KeyboardEvent, combo: string): boolean {
  const p = parseCombo(combo);
  if (!p) return false;
  return (
    normalizeKey(e.key) === p.key &&
    isPrimaryModifier(e) === p.mod &&
    e.altKey === p.alt &&
    e.shiftKey === p.shift
  );
}

const MODIFIER_KEYS = new Set(['control', 'shift', 'alt', 'meta', 'os', 'altgraph']);

/** True when the event is only a modifier being held (no real key yet) — reject in record mode. */
export function isLoneModifier(e: KeyboardEvent): boolean {
  return MODIFIER_KEYS.has(e.key.toLowerCase());
}

/** Human-readable label for display (⌘⇧F on mac, Ctrl+Shift+F elsewhere). */
export function formatCombo(combo: string): string {
  const p = parseCombo(combo);
  if (!p) return combo;
  if (isMac) {
    let s = '';
    if (p.mod) s += '⌘';
    if (p.alt) s += '⌥';
    if (p.shift) s += '⇧';
    s += displayKey(p.key);
    return s;
  }
  const tokens: string[] = [];
  if (p.mod) tokens.push('Ctrl');
  if (p.alt) tokens.push('Alt');
  if (p.shift) tokens.push('Shift');
  tokens.push(displayKey(p.key));
  return tokens.join('+');
}

function displayKey(key: string): string {
  if (key === 'enter') return '↵';
  if (key === 'space') return 'Space';
  if (key === ',') return ',';
  return key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1);
}
