import { describe, it, expect } from 'vitest';
import type { MenuCommandWire } from '@argus/shared';
import { describeMenuCommands } from '../../../electron/src/menuModel.js';
import { comboToAccelerator } from '../../../electron/src/menuShortcuts.js';
import { acceleratorToCombo, buildCheatsheet, filterCheatsheet, queryAsCombo } from './cheatsheet.js';
import { formatCombo } from './combo.js';
import { CATEGORY_ORDER } from './registry.js';
import { findConflicts, resolveShortcuts } from './useShortcuts.js';

const menu: MenuCommandWire[] = describeMenuCommands();

function sheet(overrides: Record<string, string> = {}, items: MenuCommandWire[] = menu) {
  const resolved = resolveShortcuts(overrides);
  return buildCheatsheet(resolved, findConflicts(resolved), overrides, items);
}
const rows = (groups: ReturnType<typeof sheet>) => groups.flatMap((g) => g.rows.map((r) => ({ ...r, group: g.title })));

describe('acceleratorToCombo', () => {
  it.each(['mod+n', 'mod+shift+f', 'mod+alt+l', 'mod+/', 'mod+,', 'mod+-'])('round-trips %s through comboToAccelerator', (combo) => {
    expect(acceleratorToCombo(comboToAccelerator(combo)!)?.combo).toBe(combo);
  });

  it('keeps a literal Ctrl apart and reads the plus key', () => {
    expect(acceleratorToCombo('Ctrl+CmdOrCtrl+F')).toEqual({ combo: 'mod+f', ctrl: true });
    expect(acceleratorToCombo('CmdOrCtrl+Plus')).toEqual({ combo: 'mod+plus', ctrl: false });
    expect(acceleratorToCombo('Alt+CmdOrCtrl+L')).toEqual({ combo: 'mod+alt+l', ctrl: false });
    expect(acceleratorToCombo('')).toBeNull();
  });
});

describe('buildCheatsheet', () => {
  it('lists registry groups in category order, then the menu groups', () => {
    const titles = sheet().map((g) => g.title);
    expect(titles.slice(0, CATEGORY_ORDER.length)).toEqual(CATEGORY_ORDER);
    expect(titles.slice(CATEGORY_ORDER.length)).toEqual(['App menu', 'File menu', 'View menu', 'Window menu']);
  });

  it('shows the user binding and marks it edited', () => {
    const r = rows(sheet({ 'new-session': 'mod+shift+n' })).find((x) => x.id === 'new-session')!;
    expect(r.keys).toBe(formatCombo('mod+shift+n'));
    expect(r.overridden).toBe(true);
    expect(rows(sheet()).find((x) => x.id === 'new-session')!.overridden).toBeUndefined();
  });

  it('drops a menu item whose key a registry action already lists', () => {
    const all = rows(sheet());
    expect(all.some((r) => r.id === 'menu:toggle-palette')).toBe(false);
    expect(all.some((r) => r.id === 'menu:show-shortcuts')).toBe(false);
    expect(all.filter((r) => r.id === 'command-palette')).toHaveLength(1);
  });

  it('keeps menu-only accelerators under their menu', () => {
    const all = rows(sheet());
    expect(all.find((r) => r.id === 'menu:quit-stop-all')?.group).toBe('App menu');
    expect(all.find((r) => r.id === 'menu:new-window')?.group).toBe('File menu');
    expect(all.find((r) => r.id === 'menu:zoom-in')?.keys).toMatch(/\+$/);
    expect(all.find((r) => r.id === 'role:quit')?.group).toBe('App menu');
    // Labels lose the menu ellipsis.
    expect(all.find((r) => r.id === 'menu:review-launch')?.label).toBe('Review Pending Launch');
  });

  it('flags conflicts', () => {
    const all = rows(sheet({ 'command-palette': 'mod+/' }));
    expect(all.find((r) => r.id === 'command-palette')?.conflict).toBe(true);
    expect(all.find((r) => r.id === 'show-shortcuts')?.conflict).toBe(true);
  });

  it('works with no menu (outside Electron)', () => {
    const titles = sheet({}, []).map((g) => g.title);
    expect(titles).toContain('Help');
    expect(titles).toContain('App menu'); // the system roles
  });
});

describe('filterCheatsheet', () => {
  const ids = (q: string) => rows(filterCheatsheet(sheet(), q)).map((r) => r.id);

  it('matches labels and action ids', () => {
    expect(ids('find & jump')).toEqual(['command-palette']);
    expect(ids('palette')).toEqual(['command-palette']);
  });

  it('matches glyphs and spelled-out keys', () => {
    expect(ids('⌘k')).toEqual(['command-palette']);
    expect(ids('cmd shift f').sort()).toEqual(['find-in-files', 'session-search']);
  });

  it('matches the group name and returns everything for an empty query', () => {
    expect(ids('terminal')).toContain('clear-terminal');
    expect(rows(filterCheatsheet(sheet(), '  '))).toHaveLength(rows(sheet()).length);
    expect(filterCheatsheet(sheet(), 'zzzz')).toEqual([]);
  });
});

describe('queryAsCombo', () => {
  it('reads words, glyphs and mixed forms', () => {
    expect(queryAsCombo('cmd shift f')).toEqual({ combo: 'mod+shift+f', ctrl: false });
    expect(queryAsCombo('⌘⇧F')).toEqual({ combo: 'mod+shift+f', ctrl: false });
    expect(queryAsCombo('ctrl cmd f')).toEqual({ combo: 'mod+f', ctrl: true });
    expect(queryAsCombo('cmd+k')).toEqual({ combo: 'mod+k', ctrl: false });
  });

  it('leaves plain words to the text search', () => {
    expect(queryAsCombo('terminal')).toBeNull();
    expect(queryAsCombo('f')).toBeNull();
    expect(queryAsCombo('cmd shift')).toBeNull();
  });
});
