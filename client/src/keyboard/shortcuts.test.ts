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
