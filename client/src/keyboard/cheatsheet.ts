import type { MenuCommandWire } from '@argus/shared';
import { isMac } from '../utils/platform.js';
import { formatCombo, normalizeCombo } from './combo.js';
import { CATEGORY_ORDER, SHORTCUTS, scopeOf, type ShortcutActionId } from './registry.js';
import type { ResolvedShortcuts } from './useShortcuts.js';

/**
 * The Keyboard Shortcuts sheet's content (⌘/, plan 002), generated rather than
 * written: the renderer registry with the user's bindings, then the app-menu
 * accelerators that have no registry action (New Window, Reload, Zoom…), then
 * a few system menu roles. A menu item bound to the same key as a registry
 * action is dropped, so each keystroke is listed once, under the registry's
 * wording.
 */

export interface CheatRow {
  id: string;
  label: string;
  /** Display form for this platform (⌘⇧F / Ctrl+Shift+F). */
  keys: string;
  note?: string;
  source: 'registry' | 'menu';
  conflict?: boolean;
  /** The user rebound it in Settings → Keyboard. */
  overridden?: boolean;
  /** Registry-style combo ("mod+shift+f"); with `ctrl` for a literal ⌃. For key search. */
  combo: string;
  ctrl?: boolean;
}

export interface CheatGroup {
  title: string;
  rows: CheatRow[];
}

interface ParsedAccelerator {
  combo: string;
  ctrl: boolean;
}

const ACCEL_KEYS: Record<string, string> = {
  return: 'enter', enter: 'enter', up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright',
  plus: 'plus', space: 'space', tab: 'tab', escape: 'escape', esc: 'escape',
};

/**
 * An Electron accelerator ("Alt+CmdOrCtrl+L") as a registry-style combo
 * ("mod+alt+l"). A literal Ctrl on macOS (⌃⌘F) has no registry token, so it
 * comes back as a separate flag for display only. Null for anything unparseable.
 */
export function acceleratorToCombo(acc: string): ParsedAccelerator | null {
  const parts = acc.split('+');
  // "CmdOrCtrl++" (a literal plus key) splits into a trailing empty pair.
  if (acc.endsWith('++')) parts.splice(-2, 2, 'plus');
  let mod = false;
  let alt = false;
  let shift = false;
  let ctrl = false;
  let key = '';
  for (const raw of parts) {
    const p = raw.trim().toLowerCase();
    if (!p) return null;
    if (p === 'cmdorctrl' || p === 'commandorcontrol' || p === 'cmd' || p === 'command' || p === 'super' || p === 'meta') mod = true;
    else if (p === 'ctrl' || p === 'control') ctrl = true;
    else if (p === 'alt' || p === 'option') alt = true;
    else if (p === 'shift') shift = true;
    else if (key) return null;
    else key = ACCEL_KEYS[p] ?? p;
  }
  if (!key) return null;
  const combo = [mod && 'mod', alt && 'alt', shift && 'shift', key].filter(Boolean).join('+');
  return { combo, ctrl };
}

/** Platform display form of a combo, with ⌃ for a literal Ctrl and "+" for the plus key. */
function display(combo: string, ctrl = false): string {
  const formatted = formatCombo(combo).replace(/Plus$/, '+');
  if (!ctrl) return formatted;
  return isMac ? `⌃${formatted}` : `Ctrl+${formatted}`;
}

/** Menu roles carry no accelerator property; these are the ones worth listing. */
const ROLE_ROWS: { section: string; id: string; label: string; accelerator: string }[] = [
  { section: 'App', id: 'role:hide', label: 'Hide Argus', accelerator: 'CmdOrCtrl+H' },
  { section: 'App', id: 'role:hideOthers', label: 'Hide Others', accelerator: 'Alt+CmdOrCtrl+H' },
  { section: 'App', id: 'role:quit', label: 'Quit Argus (sessions keep running)', accelerator: 'CmdOrCtrl+Q' },
  { section: 'View', id: 'role:togglefullscreen', label: 'Enter Full Screen', accelerator: 'Ctrl+CmdOrCtrl+F' },
  { section: 'Window', id: 'role:minimize', label: 'Minimize', accelerator: 'CmdOrCtrl+M' },
];

const MENU_SECTION_ORDER = ['App', 'File', 'View', 'Window', 'Help'];

export function buildCheatsheet(
  resolved: ResolvedShortcuts,
  conflicts: ReadonlySet<ShortcutActionId>,
  overrides: Record<string, string> | undefined,
  menu: readonly MenuCommandWire[],
): CheatGroup[] {
  const groups: CheatGroup[] = [];
  const registryCombos = new Set<string>();

  for (const category of CATEGORY_ORDER) {
    const rows: CheatRow[] = [];
    for (const a of SHORTCUTS) {
      if (a.category !== category) continue;
      const combo = resolved[a.id];
      if (scopeOf(a) === 'global') registryCombos.add(normalizeCombo(combo));
      rows.push({
        id: a.id,
        label: a.label,
        keys: display(combo),
        note: a.note,
        source: 'registry',
        conflict: conflicts.has(a.id) || undefined,
        overridden: (!a.fixed && !!overrides && Object.hasOwn(overrides, a.id)) || undefined,
        combo: normalizeCombo(combo),
      });
    }
    if (rows.length) groups.push({ title: category, rows });
  }

  const bySection = new Map<string, CheatRow[]>();
  const add = (section: string, id: string, label: string, accelerator: string) => {
    const parsed = acceleratorToCombo(accelerator);
    if (!parsed) return;
    if (!parsed.ctrl && registryCombos.has(normalizeCombo(parsed.combo))) return;
    const rows = bySection.get(section) ?? [];
    rows.push({
      id,
      label: label.replace(/…$/, ''),
      keys: display(parsed.combo, parsed.ctrl),
      source: 'menu',
      combo: normalizeCombo(parsed.combo),
      ...(parsed.ctrl ? { ctrl: true } : {}),
    });
    bySection.set(section, rows);
  };
  for (const item of menu) {
    if (item.accelerator) add(item.section, item.id, item.label, item.accelerator);
  }
  for (const r of ROLE_ROWS) add(r.section, r.id, r.label, r.accelerator);

  for (const section of MENU_SECTION_ORDER) {
    const rows = bySection.get(section);
    if (rows?.length) groups.push({ title: section === 'App' ? 'App menu' : `${section} menu`, rows });
  }
  return groups;
}

const MOD_WORDS: Record<string, 'mod' | 'alt' | 'shift' | 'ctrl'> = {
  cmd: 'mod', command: 'mod', '⌘': 'mod', mod: 'mod',
  shift: 'shift', '⇧': 'shift',
  alt: 'alt', opt: 'alt', option: 'alt', '⌥': 'alt',
  ctrl: 'ctrl', control: 'ctrl', '⌃': 'ctrl',
};

/**
 * A query that reads as a keystroke ("cmd shift f", "⌘⇧F", "⌘k") as
 * `{ combo, ctrl }`; null for anything else. Needs at least one modifier and
 * exactly one key, so "terminal" or "f" stay text searches.
 */
export function queryAsCombo(query: string): { combo: string; ctrl: boolean } | null {
  const tokens: string[] = [];
  for (const word of query.toLowerCase().split(/[\s+]+/).filter(Boolean)) {
    if (MOD_WORDS[word]) { tokens.push(word); continue; }
    // A glyph run like "⌘⇧f": peel the modifier glyphs off the front.
    let w = word;
    while (w.length > 1 && MOD_WORDS[w[0]]) { tokens.push(w[0]); w = w.slice(1); }
    tokens.push(w);
  }
  const mods = new Set<string>();
  let key = '';
  for (const t of tokens) {
    const m = MOD_WORDS[t];
    if (m) mods.add(m);
    else if (key) return null;
    else key = t === '+' ? 'plus' : t;
  }
  if (!key || mods.size === 0) return null;
  const combo = normalizeCombo([mods.has('mod') && 'mod', mods.has('alt') && 'alt', mods.has('shift') && 'shift', key].filter(Boolean).join('+'));
  return combo ? { combo, ctrl: mods.has('ctrl') } : null;
}

/**
 * A keystroke query matches rows bound to exactly that key; any other query
 * matches rows whose label, group, note or id contains every word.
 */
export function filterCheatsheet(groups: readonly CheatGroup[], query: string): CheatGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...groups];
  const asKey = queryAsCombo(query);
  const out: CheatGroup[] = [];
  for (const g of groups) {
    const rows = g.rows.filter((r) => {
      if (asKey) return r.combo === asKey.combo && !!r.ctrl === asKey.ctrl;
      // The id too: "palette" finds command-palette, labelled "Toggle Find & Jump".
      const hay = `${r.label} ${g.title} ${r.note ?? ''} ${r.id.replace(/[-:]/g, ' ')}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    if (rows.length) out.push({ title: g.title, rows });
  }
  return out;
}
