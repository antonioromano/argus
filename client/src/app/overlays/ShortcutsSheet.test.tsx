import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { resetMenuBridgeForTests } from '../../commands/menuBridge.js';
import { findConflicts, resolveShortcuts } from '../../keyboard/useShortcuts.js';
import { formatCombo } from '../../keyboard/combo.js';
import { ShortcutsSheet } from './ShortcutsSheet.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  resetMenuBridgeForTests();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.electronApp;
});

function render(overrides: Record<string, string> = {}) {
  const resolved = resolveShortcuts(overrides);
  const onClose = vi.fn();
  const onCustomize = vi.fn();
  act(() => {
    root.render(
      <ShortcutsSheet resolved={resolved} conflicts={findConflicts(resolved)} overrides={overrides} onClose={onClose} onCustomize={onCustomize} />,
    );
  });
  return { onClose, onCustomize };
}

const type = (value: string) => {
  const input = document.querySelector('input') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const labels = () => [...document.querySelectorAll('.setting-row-label')].map((n) => n.textContent);

describe('ShortcutsSheet', () => {
  it('renders the registry without the Electron bridge', () => {
    render();
    expect(labels()).toContain('Toggle Find & Jump');
    expect(labels()).toContain('Keyboard shortcuts');
    expect(document.body.textContent).toContain(formatCombo('mod+k'));
  });

  it('adds the menu-only accelerators from the app menu', async () => {
    window.electronApp = {
      setBadge: vi.fn(), relaunch: vi.fn(), setEditorFocused: vi.fn(), onMenuCommand: () => () => {}, invokeMenu: vi.fn(),
      describeMenu: vi.fn(async () => [{ id: 'menu:new-window', label: 'New Window', section: 'File' as const, accelerator: 'CmdOrCtrl+Shift+N', runIn: 'main' as const, palette: true }]),
    };
    render();
    await act(async () => { await Promise.resolve(); });
    expect(labels()).toContain('New Window');
  });

  it('narrows rows as you search, and says so when nothing matches', () => {
    render();
    type('palette');
    expect(labels()).toEqual(['Toggle Find & Jump']);
    type('find & jump');
    expect(labels()).toEqual(['Toggle Find & Jump']);
    type('zzzz');
    expect(document.body.textContent).toContain('No shortcut matches “zzzz”');
  });

  it('marks a rebound shortcut as edited', () => {
    render({ 'new-session': 'mod+shift+n' });
    expect(document.body.textContent).toContain(formatCombo('mod+shift+n'));
    expect(document.body.textContent).toContain('edited');
  });

  it('closes on Escape and opens Settings → Keyboard from the footer', () => {
    const { onClose, onCustomize } = render();
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(onClose).toHaveBeenCalled();
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Customize'))!;
    act(() => btn.click());
    expect(onCustomize).toHaveBeenCalledWith('keyboard');
  });
});
