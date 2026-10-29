import { describe, it, expect, afterEach, vi } from 'vitest';
import type { MenuCommandWire } from '@argus/shared';
import type { ElectronAppBridge } from '../utils/platform.js';
import { onMenuCommand, describeMenu, invokeMenu, resetMenuBridgeForTests } from './menuBridge.js';

type Listener = (id: string) => void;

function fakeBridge(over: Partial<ElectronAppBridge> = {}) {
  const listeners = new Set<Listener>();
  const bridge = {
    setBadge: vi.fn(),
    relaunch: vi.fn(),
    setEditorFocused: vi.fn(),
    onMenuCommand: (cb: Listener) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    describeMenu: vi.fn(async (): Promise<MenuCommandWire[]> => []),
    invokeMenu: vi.fn(),
    ...over,
  } satisfies ElectronAppBridge;
  window.electronApp = bridge;
  return { bridge, emit: (id: string) => listeners.forEach((l) => l(id)), listeners };
}

afterEach(() => {
  delete window.electronApp;
  resetMenuBridgeForTests();
});

describe('menuBridge', () => {
  it('forwards each menu:command id and unsubscribes', () => {
    const { emit, listeners } = fakeBridge();
    const seen: string[] = [];
    const off = onMenuCommand((id) => seen.push(id));
    emit('menu:toggle-theme');
    emit('menu:open-settings');
    expect(seen).toEqual(['menu:toggle-theme', 'menu:open-settings']);
    off();
    expect(listeners.size).toBe(0);
    emit('menu:toggle-theme');
    expect(seen).toHaveLength(2);
  });

  it('is a no-op outside Electron', async () => {
    expect(() => onMenuCommand(() => {})()).not.toThrow();
    await expect(describeMenu()).resolves.toEqual([]);
    expect(() => invokeMenu('menu:new-window')).not.toThrow();
  });

  it('asks main for the menu once and caches it', async () => {
    const wire: MenuCommandWire[] = [{ id: 'menu:new-window', label: 'New Window', section: 'File', accelerator: 'CmdOrCtrl+Shift+N', runIn: 'main', palette: true }];
    const { bridge } = fakeBridge({ describeMenu: vi.fn(async () => wire) });
    expect(await describeMenu()).toEqual(wire);
    expect(await describeMenu()).toEqual(wire);
    expect(bridge.describeMenu).toHaveBeenCalledTimes(1);
  });

  it('retries describe after a failure', async () => {
    const describe = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce([]);
    fakeBridge({ describeMenu: describe });
    expect(await describeMenu()).toEqual([]);
    await describeMenu();
    expect(describe).toHaveBeenCalledTimes(2);
  });

  it('sends invokeMenu ids to main', () => {
    const { bridge } = fakeBridge();
    invokeMenu('menu:zoom-in');
    expect(bridge.invokeMenu).toHaveBeenCalledWith('menu:zoom-in');
  });
});
