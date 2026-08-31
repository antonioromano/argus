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
  observe() {}
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

    // First real change reports once.
    currentRect = { x: 40, y: 60, width: 500, height: 250 };
    act(() => FakeResizeObserver.instances[0].trigger());
    expect(api.setRect).toHaveBeenCalledTimes(1);

    // Firing again with the SAME rect must not re-send it.
    act(() => FakeResizeObserver.instances[0].trigger());
    expect(api.setRect).toHaveBeenCalledTimes(1);

    // Also: the callback right after attach (no change at all) must not fire,
    // proving the fix for the seed-with-'' bug (attach's own rect must not
    // be immediately re-sent through setRect).
    act(() => root.unmount());
  });

  it('the first callback after attach does not immediately re-send the attach rect', async () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    await act(async () => { root.render(<Probe enabled />); });

    // No geometry change — currentRect is exactly what attach() already saw.
    act(() => FakeResizeObserver.instances[0].trigger());
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
});
