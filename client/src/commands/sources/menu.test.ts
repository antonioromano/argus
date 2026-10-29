import { describe, it, expect, vi } from 'vitest';
import { describeMenuCommands } from '../../../../electron/src/menuModel.js';
import { acceleratorToCombo, menuSource } from './menu.js';
import { stubContext } from './testContext.js';

const menu = describeMenuCommands();

describe('menuSource', () => {
  it('runs main items over menu:invoke and renderer items through the handler map', () => {
    const invokeMenu = vi.fn();
    const runMenuCommand = vi.fn();
    const cmds = menuSource(stubContext({ menu, invokeMenu, runMenuCommand }));
    cmds.find((c) => c.id === 'menu:new-window')!.run();
    expect(invokeMenu).toHaveBeenCalledWith('menu:new-window');
    cmds.find((c) => c.id === 'menu:whats-new')!.run();
    expect(runMenuCommand).toHaveBeenCalledWith('menu:whats-new');
  });

  it('gives a shortcut-linked item the shortcut: id, the menu id as alias, and the live binding', () => {
    const shortcuts = { ...stubContext().shortcuts, 'new-session': 'mod+alt+n' };
    const c = menuSource(stubContext({ menu, shortcuts })).find((x) => x.id === 'shortcut:new-session')!;
    expect(c.aliases).toEqual(['menu:new-session']);
    expect(c.shortcut).toBe('mod+alt+n');
  });

  it('skips paletteExclude items, marks Quit & Stop All destructive', () => {
    const cmds = menuSource(stubContext({ menu }));
    expect(cmds.some((c) => c.aliases?.includes('menu:toggle-palette'))).toBe(false);
    expect(cmds.find((c) => c.id === 'menu:quit-stop-all')!.destructive).toBe(true);
  });

  it('names the theme switch from the live appearance and gates focused-session items', () => {
    const light = menuSource(stubContext({ menu, isDark: false }));
    expect(light.find((c) => c.id === 'shortcut:toggle-theme')!.title).toBe('Use Dark Appearance');
    expect(light.find((c) => c.id === 'shortcut:open-diff')!.when).toBe(false);
    expect(light.find((c) => c.id === 'menu:review-launch')!.when).toBe(false);
  });

  it('converts fixed accelerators to combos', () => {
    expect(acceleratorToCombo('CmdOrCtrl+Shift+N')).toBe('mod+shift+n');
    expect(acceleratorToCombo('Shift+CmdOrCtrl+R')).toBe('mod+shift+r');
    expect(acceleratorToCombo('Alt+CmdOrCtrl+L')).toBe('mod+alt+l');
    expect(acceleratorToCombo('CmdOrCtrl+Plus')).toBe('mod+=');
  });
});
