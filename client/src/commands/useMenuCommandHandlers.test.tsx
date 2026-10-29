import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
// The pure electron-side menu model: the one list of menu items.
import { MENU_COMMANDS, RENDERER_COMMAND_IDS } from '../../../electron/src/menuModel.js';
import { MENU_SHORTCUT_DEFAULTS, type MenuShortcutId } from '../../../electron/src/menuShortcuts.js';
import { SHORTCUTS_BY_ID, type ShortcutActionId } from '../keyboard/registry.js';
import { createDedupeGate, createMenuEchoGuard } from '../keyboard/scopes.js';
import type { ElectronAppBridge } from '../utils/platform.js';
import {
  menuCommandHandlers, useMenuCommandHandlers,
  type MenuCommandDeps, type RendererMenuId,
} from './useMenuCommandHandlers.js';

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

let clock = 0;
const now = () => clock;

type ActionKey = Exclude<keyof MenuCommandDeps, 'paletteGate' | 'themeGate' | 'scopedEcho'>;
const ACTIONS: ActionKey[] = [
  'openSettings', 'togglePalette', 'toggleTheme', 'newSession', 'closeSession', 'reviewLaunch',
  'waitingInbox', 'sessionSearch', 'openDiff', 'openFiles', 'openShell', 'terminalSearch',
  'clearTerminal', 'whatsNew', 'about', 'showShortcuts', 'reportIssue', 'copyDiagnostics',
  'exportSettings', 'importSettings',
];

type Spy = ReturnType<typeof vi.fn<() => void>>;
function makeDeps(): MenuCommandDeps & Record<ActionKey, Spy> {
  const spies = Object.fromEntries(ACTIONS.map((k) => [k, vi.fn<() => void>()])) as Record<ActionKey, Spy>;
  return {
    ...spies,
    paletteGate: createDedupeGate(300, now),
    themeGate: createDedupeGate(300, now),
    scopedEcho: createMenuEchoGuard(300, now),
  };
}

// --- fake preload bridge ----------------------------------------------------
const listeners = new Set<(id: string) => void>();
const emit = (id: string) => act(() => { listeners.forEach((l) => l(id)); });

let container: HTMLDivElement;
let root: Root;
const out: { run: ((id: RendererMenuId) => void) | null } = { run: null };

function Harness({ deps }: { deps: MenuCommandDeps }) {
  const run = useMenuCommandHandlers(deps);
  useEffect(() => { out.run = run; });
  return null;
}
const mount = (deps: MenuCommandDeps) => act(() => { root.render(<Harness deps={deps} />); });

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  clock = 1_000;
  listeners.clear();
  out.run = null;
  window.electronApp = {
    setBadge: vi.fn(), relaunch: vi.fn(), setEditorFocused: vi.fn(),
    onMenuCommand: (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    describeMenu: vi.fn(async () => []), invokeMenu: vi.fn(),
  } satisfies ElectronAppBridge;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.electronApp;
});

describe('menu command coverage', () => {
  // This is the check that would have caught Settings…, Toggle Find & Jump and
  // Toggle Theme doing nothing: every renderer-run item in the menu model must
  // reach a handler, and each handler must actually run something.
  it('every renderer-run menu item has a handler that runs exactly one action', () => {
    const handlers = menuCommandHandlers(makeDeps());
    const handled = Object.keys(handlers).sort();
    expect(handled).toEqual([...RENDERER_COMMAND_IDS].sort());

    for (const id of RENDERER_COMMAND_IDS) {
      clock += 1_000; // clear of every dedupe window
      const deps = makeDeps();
      menuCommandHandlers(deps)[id]();
      const ran = ACTIONS.filter((k) => deps[k].mock.calls.length > 0);
      expect(ran, `${id} must run one action`).toHaveLength(1);
    }
  });

  it('main-run items are not handled in the renderer', () => {
    const handlers = menuCommandHandlers(makeDeps());
    for (const c of MENU_COMMANDS.filter((m) => m.runIn === 'main')) {
      expect(Object.hasOwn(handlers, c.id), c.id).toBe(false);
    }
  });

  // menuShortcuts.ts duplicates these defaults (main cannot import the
  // registry); this pins the copy so a drift fails here, not as a stale menu.
  it('menu shortcut defaults match the keyboard registry', () => {
    for (const [id, combo] of Object.entries(MENU_SHORTCUT_DEFAULTS) as [MenuShortcutId, string][]) {
      expect(SHORTCUTS_BY_ID[id as ShortcutActionId]?.defaultCombo, id).toBe(combo);
    }
  });
});

describe('useMenuCommandHandlers', () => {
  it('runs the three items that used to do nothing', () => {
    const deps = makeDeps();
    mount(deps);
    emit('menu:open-settings');
    expect(deps.openSettings).toHaveBeenCalledTimes(1);
    emit('menu:toggle-palette');
    expect(deps.togglePalette).toHaveBeenCalledTimes(1);
    emit('menu:toggle-theme');
    expect(deps.toggleTheme).toHaveBeenCalledTimes(1);
  });

  it('does not double-toggle the palette when one ⌘K reaches both keydown and the menu', () => {
    const deps = makeDeps();
    mount(deps);
    // Keydown path first (ArgusApp's command-palette case), then the menu echo.
    deps.paletteGate.run(deps.togglePalette);
    clock += 50;
    emit('menu:toggle-palette');
    expect(deps.togglePalette).toHaveBeenCalledTimes(1);

    // The other order: the menu first, then the keydown.
    clock += 1_000;
    emit('menu:toggle-palette');
    clock += 50;
    deps.paletteGate.run(deps.togglePalette);
    expect(deps.togglePalette).toHaveBeenCalledTimes(2);
  });

  it('a menu click with no keydown claim toggles every time', () => {
    const deps = makeDeps();
    mount(deps);
    emit('menu:toggle-palette');
    clock += 301;
    emit('menu:toggle-palette');
    expect(deps.togglePalette).toHaveBeenCalledTimes(2);
  });

  it('does not double-toggle the theme on one ⌘⇧L', () => {
    const deps = makeDeps();
    mount(deps);
    deps.themeGate.run(deps.toggleTheme);
    clock += 10;
    emit('menu:toggle-theme');
    expect(deps.toggleTheme).toHaveBeenCalledTimes(1);
  });

  it('drops the session-search echo of a scoped ⌘⇧F', () => {
    const deps = makeDeps();
    mount(deps);
    deps.scopedEcho.claim();
    emit('menu:session-search');
    expect(deps.sessionSearch).not.toHaveBeenCalled();
    clock += 301;
    emit('menu:session-search');
    expect(deps.sessionSearch).toHaveBeenCalledTimes(1);
  });

  it('ignores ids it does not handle', () => {
    const deps = makeDeps();
    mount(deps);
    emit('menu:new-window');
    emit('menu:nope');
    emit('toString');
    for (const k of ACTIONS) expect(deps[k]).not.toHaveBeenCalled();
  });

  it('reads the latest deps without resubscribing, and unsubscribes on unmount', () => {
    const first = makeDeps();
    mount(first);
    expect(listeners.size).toBe(1);
    const second = makeDeps();
    mount(second);
    expect(listeners.size).toBe(1);
    emit('menu:whats-new');
    expect(first.whatsNew).not.toHaveBeenCalled();
    expect(second.whatsNew).toHaveBeenCalledTimes(1);

    // The returned run(id) is stable and runs the latest deps too (the palette's path).
    const run = out.run!;
    const third = makeDeps();
    mount(third);
    expect(out.run).toBe(run);
    act(() => run('menu:open-settings'));
    expect(third.openSettings).toHaveBeenCalledTimes(1);
    expect(second.openSettings).not.toHaveBeenCalled();

    act(() => root.unmount());
    expect(listeners.size).toBe(0);
    root = createRoot(container); // afterEach unmounts again
  });
});
