import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// The app status bar (plan 009 S2) sits below the mosaic, so showing, hiding or
// re-sizing it (density) only changes the height of each terminal's mount. The
// relayout must reach xterm through the one doFit funnel — the mount's
// ResizeObserver, debounced — once per change, not once per observer tick.

let height = 600;

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
    loadAddon(addon: { term?: Terminal }) { addon.term = this; }
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
// 20px cells: the fit derives rows from the mount's current height.
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class { term?: { rows: number }; fit() { if (this.term) this.term.rows = Math.floor(height / 20); } },
}));
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
  return { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
}

function Host({ socket }: { socket: ReturnType<typeof makeSocket> }) {
  const ref = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double
  useTerminal(ref, { sessionId: 's1', socket: socket as any, theme: 'dark' });
  return <div ref={ref} data-testid="mount" />;
}

const observers: { cb: ResizeObserverCallback; targets: Element[] }[] = [];
class FakeResizeObserver {
  private readonly entry: { cb: ResizeObserverCallback; targets: Element[] };
  constructor(cb: ResizeObserverCallback) {
    this.entry = { cb, targets: [] };
    observers.push(this.entry);
  }
  observe(el: Element) { this.entry.targets.push(el); }
  unobserve() {}
  disconnect() {}
}

let container: HTMLDivElement;
let root: Root;
let frames: FrameRequestCallback[];

const fits = () => (window as Window & { __argusFit?: number }).__argusFit ?? 0;
const resizes = (socket: ReturnType<typeof makeSocket>) =>
  socket.emit.mock.calls.filter((c) => c[0] === 'session:resize').map((c) => c[1]);

/** What the browser does while the status bar mounts: a few observer ticks during layout. */
function layoutTicks(mount: Element, n: number) {
  const ro = observers.find((o) => o.targets.includes(mount))!;
  for (let i = 0; i < n; i++) ro.cb([], ro as unknown as ResizeObserver);
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  height = 600;
  observers.length = 0;
  frames = [];
  (window as Window & { __argusFit?: number }).__argusFit = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => height);
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { root = createRoot(container); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
});

function mount() {
  const socket = makeSocket();
  act(() => { root.render(<Host socket={socket} />); });
  act(() => { for (const f of frames.splice(0)) f(0); });
  socket.emit.mockClear();
  return { socket, el: container.querySelector('[data-testid="mount"]')! };
}

describe('status bar height change → terminal relayout', () => {
  it('observes the terminal mount itself, so any change in its height reaches the fit', () => {
    const { el } = mount();
    expect(observers.some((o) => o.targets.includes(el))).toBe(true);
  });

  it('the bar appearing (22px less height) is one doFit and one resize, however many observer ticks', () => {
    const { socket, el } = mount();
    const before = fits();
    height = 600 - 22;
    layoutTicks(el, 4);
    act(() => { vi.advanceTimersByTime(99); });
    expect(fits()).toBe(before); // still debouncing
    act(() => { vi.advanceTimersByTime(1); });
    expect(fits()).toBe(before + 1);
    expect(resizes(socket)).toEqual([{ sessionId: 's1', cols: 80, rows: Math.floor(578 / 20) }]);
  });

  it('the bar going away, or a density change to its height, refits again', () => {
    const { socket, el } = mount();
    height = 578;
    layoutTicks(el, 2);
    act(() => { vi.advanceTimersByTime(100); });
    height = 600;
    layoutTicks(el, 2);
    act(() => { vi.advanceTimersByTime(100); });
    expect(resizes(socket).map((r) => r.rows)).toEqual([28, 30]);
  });
});
