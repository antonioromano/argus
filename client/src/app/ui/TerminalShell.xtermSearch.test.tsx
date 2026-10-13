/* eslint-disable @typescript-eslint/no-explicit-any -- xterm/socket test doubles */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionInfo } from '@argus/shared';

// Every SearchAddon the shell creates, in order, with its results listeners.
// dispose() mirrors xterm: a disposed addon's emitter never fires again.
const addons: Array<{ listeners: Set<(r: any) => void>; disposed: boolean; fire(i: number, n: number): void }> = [];

vi.mock('@xterm/xterm', () => {
  const disposable = () => ({ dispose: () => {} });
  class Terminal {
    cols = 80;
    rows = 24;
    options: Record<string, unknown>;
    constructor(opts: Record<string, unknown>) { this.options = { ...opts }; }
    element: HTMLElement | undefined;
    buffer = { active: { type: 'normal', viewportY: 0, baseY: 0 } };
    onBell = disposable;
    onScroll = disposable;
    onData = disposable;
    addons: Array<{ dispose?: () => void }> = [];
    loadAddon(a: { dispose?: () => void }) { this.addons.push(a); }
    registerLinkProvider() {}
    open(el: HTMLElement) { this.element = el; }
    focus() {}
    write() {}
    refresh() {}
    resize() {}
    scrollToBottom() {}
    scrollLines() {}
    hasSelection() { return false; }
    getSelection() { return ''; }
    attachCustomKeyEventHandler() {}
    dispose() { for (const a of this.addons) a.dispose?.(); }
  }
  return { Terminal };
});
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {
    listeners = new Set<(r: any) => void>();
    disposed = false;
    constructor() { addons.push(this); }
    onDidChangeResults(cb: (r: any) => void) {
      this.listeners.add(cb);
      return { dispose: () => this.listeners.delete(cb) };
    }
    fire(i: number, n: number) {
      if (this.disposed) return;
      for (const cb of this.listeners) cb({ resultIndex: i, resultCount: n });
    }
    findNext() {}
    findPrevious() {}
    clearDecorations() {}
    dispose() { this.disposed = true; this.listeners.clear(); }
  },
}));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));
vi.mock('../../hooks/terminalMouse.js', () => ({
  installSelectableMouse: () => ({ dispose: () => {}, reconcileMouse: () => {} }),
}));
vi.mock('../../hooks/terminalLinks.js', () => ({ createTerminalLinkProvider: () => ({}) }));

import { TerminalShell } from './TerminalShell.js';

const session = { id: 's1', status: 'idle' } as unknown as SessionInfo;
const socket = { emit: vi.fn(), on: vi.fn(), off: vi.fn() } as any;

let container: HTMLDivElement;
let root: Root;
let resolveFonts: () => void;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  addons.length = 0;
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  // Cold start: fonts not loaded yet, so useTerminal rebuilds the terminal
  // (and its SearchAddon) once they are.
  const ready = new Promise<void>((r) => { resolveFonts = r; });
  Object.defineProperty(document, 'fonts', { configurable: true, value: { status: 'loading', ready } });
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { root = createRoot(container); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (document as any).fonts;
  vi.unstubAllGlobals();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = undefined;
});

const countText = () => container.textContent ?? '';

describe('TerminalShell xterm search — terminal rebuild', () => {
  it('keeps the open search bar\'s match count live after the terminal is rebuilt', async () => {
    // Open the bar after the terminal exists (the usual Cmd+F path).
    act(() => root.render(<TerminalShell session={session} socket={socket} theme="dark" searchOpen={false} onCloseSearch={() => {}} />));
    act(() => root.render(<TerminalShell session={session} socket={socket} theme="dark" searchOpen onCloseSearch={() => {}} />));
    expect(addons).toHaveLength(1);
    // Give the bar a query so it renders "i/n" rather than an empty label.
    const input = container.querySelector('input') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => { setter.call(input, 'foo'); input.dispatchEvent(new Event('input', { bubbles: true })); });

    act(() => addons[0].fire(0, 3));
    expect(countText()).toContain('1/3');

    // fontsReady flips → terminal + SearchAddon rebuilt, bar stays open.
    await act(async () => { resolveFonts(); await Promise.resolve(); });
    expect(addons).toHaveLength(2);
    expect(addons[0].disposed).toBe(true);

    act(() => addons[1].fire(1, 5));
    expect(countText()).toContain('2/5');
  });
});
