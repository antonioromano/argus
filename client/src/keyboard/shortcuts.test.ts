import { describe, it, expect } from 'vitest';
import { SHORTCUTS, SHORTCUTS_BY_ID, type ShortcutActionId } from './registry.js';
import { resolveShortcuts, matchEvent, findConflicts } from './useShortcuts.js';
import { isMac } from '../utils/platform.js';

/** A keydown carrying the primary modifier for this platform. */
const press = (key: string, extra: Partial<KeyboardEventInit> = {}): KeyboardEvent =>
  new KeyboardEvent('keydown', { key, [isMac ? 'metaKey' : 'ctrlKey']: true, ...extra });

describe('shortcut registry', () => {
  it('binds no two actions to the same default', () => {
    expect([...findConflicts(resolveShortcuts())]).toEqual([]);
  });

  // The ⋯ menu advertises these three. Before they were bound, the menu showed
  // keys that did nothing at all.
  it.each([
    ['open-diff', 'mod+d'],
    ['open-files', 'mod+e'],
    ['open-shell', 'mod+t'],
  ] as [ShortcutActionId, string][])('binds %s to %s', (id, combo) => {
    expect(resolveShortcuts()[id]).toBe(combo);
  });

  it.each([
    ['d', 'open-diff'],
    ['e', 'open-files'],
    ['t', 'open-shell'],
  ] as [string, ShortcutActionId][])('routes %s to %s', (key, id) => {
    expect(matchEvent(press(key), resolveShortcuts())).toBe(id);
  });

  it('does not fire the shell actions without the primary modifier', () => {
    const resolved = resolveShortcuts();
    for (const key of ['d', 'e', 't']) {
      expect(matchEvent(new KeyboardEvent('keydown', { key }), resolved)).toBeNull();
    }
  });

  it('lets a rebind win, and routes the new combo', () => {
    const resolved = resolveShortcuts({ 'open-diff': 'mod+shift+d' });
    expect(resolved['open-diff']).toBe('mod+shift+d');
    expect(matchEvent(press('d'), resolved)).toBeNull();
    expect(matchEvent(press('d', { shiftKey: true }), resolved)).toBe('open-diff');
  });

  it('keeps every action rebindable except the two that are owned elsewhere', () => {
    const fixed = SHORTCUTS.filter((s) => s.fixed).map((s) => s.id);
    expect(fixed).toEqual(['close-shell', 'terminal-newline']);
    expect(SHORTCUTS_BY_ID['open-diff'].fixed).toBeUndefined();
  });
});

describe('waiting inbox shortcut', () => {
  it('defaults to a combo no other action, Monaco or the app menu uses', () => {
    // Cmd+Shift+I is Monaco's Format Document; Cmd+Shift+L/N/Q are app-menu items.
    expect(resolveShortcuts()['waiting-inbox']).toBe('mod+shift+j');
  });
});

describe('find in files shortcut', () => {
  it('defaults to ⌘⇧F, scoped to the explorer', () => {
    expect(resolveShortcuts()['find-in-files']).toBe('mod+shift+f');
    expect(SHORTCUTS_BY_ID['find-in-files'].scope).toBe('explorer');
  });

  it('leaves ⌘⇧F to session search in the app-wide handler', () => {
    expect(matchEvent(press('F', { shiftKey: true }), resolveShortcuts())).toBe('session-search');
  });

  it('never matches a scoped action app-wide, even when rebound', () => {
    const resolved = resolveShortcuts({ 'find-in-files': 'mod+alt+g' });
    expect(matchEvent(press('g', { altKey: true }), resolved)).toBeNull();
  });

  it('flags a clash inside the explorer scope but not one with a global action', () => {
    expect(findConflicts(resolveShortcuts()).has('find-in-files')).toBe(false);
    // Two global actions on the same combo still conflict.
    const clash = findConflicts(resolveShortcuts({ 'open-diff': 'mod+e' }));
    expect(clash.has('open-diff') && clash.has('open-files')).toBe(true);
  });
});

describe('session inspector shortcut', () => {
  it('toggles on the primary modifier + I, and can be rebound', () => {
    expect(resolveShortcuts()['toggle-inspector']).toBe('mod+i');
    expect(matchEvent(press('i'), resolveShortcuts())).toBe('toggle-inspector');
    expect(matchEvent(new KeyboardEvent('keydown', { key: 'i' }), resolveShortcuts())).toBeNull();
    expect(SHORTCUTS_BY_ID['toggle-inspector'].fixed).toBeUndefined();
  });
});
