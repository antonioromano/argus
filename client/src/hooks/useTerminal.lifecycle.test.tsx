import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Minimal xterm stand-in: the lifecycle under test is the effect's deferred
// join/resize, not rendering, and jsdom can't host a real xterm anyway.
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
    loadAddon() {}
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
    dispose() {}
  }
  return { Terminal };
});
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class { onDidChangeResults() { return { dispose: () => {} }; } } }));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));
vi.mock('./terminalMouse.js', () => ({
  installSelectableMouse: () => ({ dispose: () => {}, reconcileMouse: () => {} }),
}));
vi.mock('./terminalLinks.js', () => ({ createTerminalLinkProvider: () => ({}) }));

import { useTerminal } from './useTerminal.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function makeSocket() {
  const emit = vi.fn();
  return { emit, on: vi.fn(), off: vi.fn() };
}

function Host({ socket }: { socket: ReturnType<typeof makeSocket> }) {
  const ref = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double
  useTerminal(ref, { sessionId: 's1', socket: socket as any, theme: 'dark' });
  return <div ref={ref} />;
}

let container: HTMLDivElement;
let root: Root;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;

function flushFrames() {
  const pending = [...frames.values()];
  frames.clear();
  for (const cb of pending) cb(0);
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  frames = new Map();
  nextFrame = 1;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextFrame++;
    frames.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  // Non-zero layout so the first frame's fit + resize path runs.
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { root = createRoot(container); });
});

afterEach(() => {
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
});

const events = (socket: ReturnType<typeof makeSocket>) => socket.emit.mock.calls.map((c) => c[0]);

describe('useTerminal mount lifecycle', () => {
  it('joins (after a forced resize) on the first frame', () => {
    const socket = makeSocket();
    act(() => { root.render(<Host socket={socket} />); });
    expect(events(socket)).not.toContain('session:join');

    act(() => { flushFrames(); });
    expect(events(socket)).toEqual(['session:resize', 'session:join']);
    act(() => root.unmount());
  });

  it('unmounting before the first frame emits no session:join or resize after leave', () => {
    const socket = makeSocket();
    act(() => { root.render(<Host socket={socket} />); });
    act(() => root.unmount());
    expect(events(socket)).toEqual(['session:leave']);

    act(() => { flushFrames(); });
    expect(events(socket)).toEqual(['session:leave']);
  });
});
