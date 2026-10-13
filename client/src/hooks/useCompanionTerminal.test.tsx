import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// Fake xterm: fit() moves the grid to the container's real size.
vi.mock('@xterm/xterm', () => {
  class Terminal {
    cols = 80;
    rows = 24;
    options: Record<string, unknown> = {};
    buffer = { active: { viewportY: 0, baseY: 0 } };
    onBell() { return { dispose() {} }; }
    loadAddon(a: { _term?: Terminal }) { a._term = this; }
    registerLinkProvider() {}
    open() {}
    onScroll() { return { dispose() {} }; }
    attachCustomKeyEventHandler() {}
    onData() { return { dispose() {} }; }
    write() {}
    refresh() {}
    scrollToBottom() {}
    clear() {}
    hasSelection() { return false; }
    dispose() {}
  }
  return { Terminal };
});
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    _term?: { cols: number; rows: number };
    fit() { if (this._term) { this._term.cols = 173; this._term.rows = 41; } }
  },
}));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));
vi.mock('./terminalMouse.js', () => ({ installSelectableMouse: () => ({ dispose() {} }) }));
vi.mock('./terminalLinks.js', () => ({ createTerminalLinkProvider: () => ({}) }));
vi.mock('./terminalRichCopy.js', () => ({ terminalCopyFlavors: () => ({}), xtermSelectionWithBold: () => '' }));
vi.mock('../context/font-settings-context.js', () => ({ useFontSettings: () => ({ codeFontSize: 13 }) }));

import { useCompanionTerminal } from './useCompanionTerminal.js';

function createFakeSocket() {
  const emitted: [string, unknown][] = [];
  const handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  return {
    emitted,
    on: (e: string, cb: (...a: unknown[]) => void) => {
      if (!handlers.has(e)) handlers.set(e, new Set());
      handlers.get(e)!.add(cb);
    },
    off: (e: string, cb: (...a: unknown[]) => void) => { handlers.get(e)?.delete(cb); },
    emit: (e: string, payload?: unknown) => { emitted.push([e, payload]); },
    fire: (e: string, ...a: unknown[]) => handlers.get(e)?.forEach((cb) => cb(...a)),
  };
}

describe('useCompanionTerminal sizing on join', () => {
  let container: HTMLDivElement;
  let root: Root;
  let socket: ReturnType<typeof createFakeSocket>;
  const rafs: FrameRequestCallback[] = [];

  function Probe() {
    const ref = useRef<HTMLDivElement | null>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake socket
    useCompanionTerminal(ref, { sessionId: 's1', socket: socket as any, theme: 'dark' });
    return <div ref={(el) => {
      if (el) {
        Object.defineProperty(el, 'offsetWidth', { value: 800, configurable: true });
        Object.defineProperty(el, 'offsetHeight', { value: 600, configurable: true });
      }
      ref.current = el;
    }} />;
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    rafs.length = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { rafs.push(cb); return rafs.length; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { rafs[id - 1] = () => {}; });
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    Object.defineProperty(document, 'fonts', { value: { status: 'loaded' }, configurable: true });
    socket = createFakeSocket();
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => { root = createRoot(container); });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  const ctEvents = () => socket.emitted.filter(([e]) => e.startsWith('ct:'));

  it('reports the real grid size around ct:join, never joining before the first fit', () => {
    act(() => root.render(<Probe />));
    // Nothing joins before layout has been measured.
    expect(ctEvents().some(([e]) => e === 'ct:join')).toBe(false);
    act(() => rafs.splice(0).forEach((cb) => cb(0)));

    const ev = ctEvents();
    const joinIdx = ev.findIndex(([e]) => e === 'ct:join');
    expect(joinIdx).toBeGreaterThan(-1);
    // Resize before join (an already-running shell is sized before its buffer replays)…
    expect(ev[joinIdx - 1]).toEqual(['ct:resize', { sessionId: 's1', cols: 173, rows: 41 }]);
    // …and right after it, in the same tick (a first join spawns at the server default).
    expect(ev[joinIdx + 1]).toEqual(['ct:resize', { sessionId: 's1', cols: 173, rows: 41 }]);
  });

  it('a pending first-frame join is cancelled on unmount (no join after ct:leave)', () => {
    act(() => root.render(<Probe />));
    act(() => root.unmount());
    rafs.splice(0).forEach((cb) => cb(0));
    expect(ctEvents().some(([e]) => e === 'ct:join')).toBe(false);
    act(() => { root = createRoot(container); }); // for afterEach
  });

  it('on reconnect, resizes before and after re-joining', () => {
    act(() => root.render(<Probe />));
    act(() => rafs.splice(0).forEach((cb) => cb(0)));
    socket.emitted.length = 0;
    act(() => socket.fire('connect'));
    expect(ctEvents().map(([e]) => e)).toEqual(['ct:resize', 'ct:join', 'ct:resize']);
  });
});
