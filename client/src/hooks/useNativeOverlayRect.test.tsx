/* eslint-disable @typescript-eslint/no-explicit-any -- window/global test shims for the electron bridge + React act environment */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useNativeOverlayRect } from './useNativeOverlayRect.js';

const api = { attach: vi.fn().mockResolvedValue(true), setRect: vi.fn(), detach: vi.fn(), available: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  api.attach.mockResolvedValue(true);
  (window as any).electronNativeTerminal = api;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

function Probe({ enabled, onFailure }: { enabled: boolean; onFailure?: () => void }) {
  const ref = useNativeOverlayRect('s1', enabled, onFailure);
  return <div ref={ref} data-testid="hole" />;
}

// Mirrors how TerminalShellNativeHole actually calls the hook: a fresh
// `() => setFailed(true)` closure constructed inline on every render. `tick`
// is an unrelated prop (stands in for status/focused/searchOpen/... changing
// during ordinary use) that forces a re-render without touching sessionId or
// enabled.
function ProbeWithInlineOnFailure({ tick }: { tick: number }) {
  const ref = useNativeOverlayRect('s1', true, () => {});
  return <div ref={ref} data-testid="hole" data-tick={tick} />;
}

describe('useNativeOverlayRect', () => {
  it('attaches with the hole rect when enabled', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    act(() => root.render(<Probe enabled />));
    expect(api.attach).toHaveBeenCalledTimes(1);
    expect(api.attach.mock.calls[0][0]).toBe('s1');
    act(() => root.unmount());
  });

  it('does nothing at all when disabled — the web path must be untouched', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    act(() => root.render(<Probe enabled={false} />));
    expect(api.attach).not.toHaveBeenCalled();
    expect(api.setRect).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it('detaches on unmount so the overlay cannot outlive its tile', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    act(() => root.render(<Probe enabled />));
    act(() => root.unmount());
    expect(api.detach).toHaveBeenCalledWith('s1');
  });

  it('calls onFailure when the main process reports attach failed', async () => {
    api.attach.mockResolvedValueOnce(false);
    const onFailure = vi.fn();
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    await act(async () => { root.render(<Probe enabled onFailure={onFailure} />); });
    expect(onFailure).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it('does not call onFailure when attach succeeds', async () => {
    api.attach.mockResolvedValueOnce(true);
    const onFailure = vi.fn();
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    await act(async () => { root.render(<Probe enabled onFailure={onFailure} />); });
    expect(onFailure).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  // Regression: TerminalShellNativeHole calls the hook with an inline
  // `() => setFailed(true)` closure, so a NEW `onFailure` function identity
  // arrives on every render of that component (status/focused/searchOpen/...
  // all change during ordinary use, and it isn't memoized upstream). If the
  // hook's effect depends on `onFailure` directly, that new identity tears
  // down and recreates the overlay — a real NSWindow via addon.destroy/create
  // — on every such re-render, not just on session/enabled changes.
  it('does not tear down and recreate the overlay when only an unrelated prop re-renders the caller', async () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    await act(async () => { root.render(<ProbeWithInlineOnFailure tick={1} />); });
    expect(api.attach).toHaveBeenCalledTimes(1);

    await act(async () => { root.render(<ProbeWithInlineOnFailure tick={2} />); });
    expect(api.attach).toHaveBeenCalledTimes(1);
    expect(api.detach).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });
});

/**
 * jsdom does not implement ResizeObserver, so useNativeOverlayRect guards it
 * behind a `typeof` check (see the hook). These tests install a fake global
 * to drive the observer callback directly and stub getBoundingClientRect to
 * control the geometry the hook measures — proving the actual reporting
 * behaviour, not just that attach/detach fire.
 */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  private readonly cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
    FakeResizeObserver.instances.push(this);
  }
  observe() {
    // The real ResizeObserver contract delivers one initial notification as
    // soon as observation starts, carrying the size AT THAT MOMENT — not
    // only on later changes. The hook's async-window safety net (a geometry
    // change that lands while `attach()` is still pending, before observers
    // are installed) relies on exactly this initial delivery to self-heal;
    // a no-op stub here would let that reliance go unverified.
    this.trigger();
  }
  unobserve() {}
  disconnect() {}
  /** Simulate the browser invoking the observer's callback. */
  trigger() {
    this.cb([] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver);
  }
}

describe('useNativeOverlayRect — reported geometry', () => {
  const originalGetRect = HTMLDivElement.prototype.getBoundingClientRect;
  const originalRO = (globalThis as any).ResizeObserver;
  let currentRect = { x: 0, y: 0, width: 0, height: 0 };

  beforeEach(() => {
    currentRect = { x: 10, y: 20, width: 300.6, height: 150.4 };
    HTMLDivElement.prototype.getBoundingClientRect = function (this: HTMLDivElement) {
      // Only the probed hole element matters for these tests.
      return { ...currentRect } as DOMRect;
    };
    FakeResizeObserver.instances = [];
    (globalThis as any).ResizeObserver = FakeResizeObserver;
  });

  afterEach(() => {
    HTMLDivElement.prototype.getBoundingClientRect = originalGetRect;
    (globalThis as any).ResizeObserver = originalRO;
  });

  it('attaches with the actual measured rect, rounded', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    act(() => root.render(<Probe enabled />));
    expect(api.attach).toHaveBeenCalledWith('s1', { x: 10, y: 20, width: 301, height: 150 });
    act(() => root.unmount());
  });

  it('reports a geometry change via setRect', async () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    await act(async () => { root.render(<Probe enabled />); });
    expect(FakeResizeObserver.instances).toHaveLength(1);

    currentRect = { x: 40, y: 60, width: 500, height: 250 };
    act(() => FakeResizeObserver.instances[0].trigger());

    expect(api.setRect).toHaveBeenCalledWith('s1', { x: 40, y: 60, width: 500, height: 250 });
    act(() => root.unmount());
  });

  it('dedupes: an unchanged rect does not re-report', async () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    await act(async () => { root.render(<Probe enabled />); });

    // The first observation after attach always reports — see the test below
    // for why it must. That is call 1.
    act(() => FakeResizeObserver.instances[0].trigger());
    expect(api.setRect).toHaveBeenCalledTimes(1);

    // A real change reports again.
    currentRect = { x: 40, y: 60, width: 500, height: 250 };
    act(() => FakeResizeObserver.instances[0].trigger());
    expect(api.setRect).toHaveBeenCalledTimes(2);

    // Firing again with the SAME rect must not re-send it.
    act(() => FakeResizeObserver.instances[0].trigger());
    expect(api.setRect).toHaveBeenCalledTimes(2);
    act(() => root.unmount());
  });

  it('the first callback after attach reports, even with no geometry change', async () => {
    // Inverted deliberately. Main no longer lets a re-attach decide visibility
    // from its own mount-time rect (that measurement reads as a full-size hole
    // during a maximized workbench, and resurrected the overlay on top of it).
    // The renderer's first observation is now what establishes visibility, so
    // seeding lastRectKey from the attach rect would let that observation be
    // deduped away — leaving the overlay hidden with nothing scheduled to
    // reveal it. One redundant setRect on mount is the whole cost.
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    await act(async () => { root.render(<Probe enabled />); });

    act(() => FakeResizeObserver.instances[0].trigger());
    expect(api.setRect).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it('re-measures when a CSS animation on an ancestor ends — a pure translation fires no observer', async () => {
    // .argus-tile fades in from translateY(4px). The hole was captured
    // mid-animation and then the tile moved 4px without changing size, so
    // ResizeObserver never fired and the overlay sat 4px low for good.
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    await act(async () => { root.render(<Probe enabled />); });
    act(() => FakeResizeObserver.instances[0].trigger());   // establishes the initial rect
    api.setRect.mockClear();

    // The tile settles 4px higher; its size is unchanged, so no RO callback.
    currentRect = { x: 10, y: 16, width: 300, height: 200 };
    act(() => { document.body.dispatchEvent(new Event('animationend', { bubbles: true })); });

    expect(api.setRect).toHaveBeenCalledWith('s1', { x: 10, y: 16, width: 300, height: 200 });
    act(() => root.unmount());
  });

  it('re-measures when a CSS transition on an ancestor ends — dnd-kit reorders move tiles this way', async () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    await act(async () => { root.render(<Probe enabled />); });
    act(() => FakeResizeObserver.instances[0].trigger());
    api.setRect.mockClear();

    currentRect = { x: 400, y: 20, width: 300, height: 200 };
    act(() => { document.body.dispatchEvent(new Event('transitionend', { bubbles: true })); });

    expect(api.setRect).toHaveBeenCalledWith('s1', { x: 400, y: 20, width: 300, height: 200 });
    act(() => root.unmount());
  });

  it('an animation that moved nothing costs no IPC', async () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    await act(async () => { root.render(<Probe enabled />); });
    act(() => FakeResizeObserver.instances[0].trigger());
    api.setRect.mockClear();

    act(() => { document.body.dispatchEvent(new Event('animationend', { bubbles: true })); });

    expect(api.setRect).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it('reports coordinates as viewport-relative — no scroll arithmetic added', () => {
    // Main adds the window's own content-bounds origin; if this hook also
    // added scroll offsets, the overlay would be double-counted and visibly
    // mispositioned whenever the page/tile has scrolled.
    const originalScrollX = window.scrollX;
    const originalScrollY = window.scrollY;
    Object.defineProperty(window, 'scrollX', { value: 500, configurable: true });
    Object.defineProperty(window, 'scrollY', { value: 800, configurable: true });

    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    act(() => root.render(<Probe enabled />));

    expect(api.attach).toHaveBeenCalledWith('s1', { x: 10, y: 20, width: 301, height: 150 });

    act(() => root.unmount());
    Object.defineProperty(window, 'scrollX', { value: originalScrollX, configurable: true });
    Object.defineProperty(window, 'scrollY', { value: originalScrollY, configurable: true });
  });

  it('a geometry change while attach() is still pending is not lost — the observer self-heals it on install', async () => {
    // attach() is now awaited, so there's a window between "measure the
    // initial rect" and "install the ResizeObserver" during which the hole
    // can move without anything watching it yet. The safety net this test
    // proves: ResizeObserver.observe() delivers one notification immediately
    // with the CURRENT size, so a change that happened during the await is
    // picked up as soon as observers install, not lost.
    let resolveAttach!: (ok: boolean) => void;
    api.attach.mockImplementationOnce(() => new Promise<boolean>((resolve) => { resolveAttach = resolve; }));

    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    await act(async () => { root.render(<Probe enabled />); });

    // attach() saw the ORIGINAL rect and is still pending.
    expect(api.attach).toHaveBeenCalledWith('s1', { x: 10, y: 20, width: 301, height: 150 });
    expect(api.setRect).not.toHaveBeenCalled();

    // The hole moves while attach() is in flight — nothing is observing yet.
    currentRect = { x: 99, y: 88, width: 400, height: 300 };

    // Resolving now installs the ResizeObserver, which immediately reports
    // the CURRENT (moved) rect rather than the stale one attach() saw.
    await act(async () => { resolveAttach(true); });

    expect(api.setRect).toHaveBeenCalledWith('s1', { x: 99, y: 88, width: 400, height: 300 });

    await act(async () => root.unmount());
  });
});
