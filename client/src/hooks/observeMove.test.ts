/* eslint-disable @typescript-eslint/no-explicit-any -- IntersectionObserver global shim */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { observeMove } from './observeMove.js';

/** Records each observer with its options so tests can play the browser. */
class FakeIO {
  static instances: FakeIO[] = [];
  readonly cb: IntersectionObserverCallback;
  readonly options: IntersectionObserverInit;
  disconnected = false;
  constructor(cb: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
    this.cb = cb;
    this.options = options;
    FakeIO.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() { this.disconnected = true; }
  fire(intersectionRatio: number) {
    this.cb([{ intersectionRatio } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}
const latest = () => FakeIO.instances[FakeIO.instances.length - 1];

describe('observeMove', () => {
  const originalIO = (globalThis as any).IntersectionObserver;
  let rect = { left: 0, top: 0, width: 0, height: 0 };
  let el: HTMLDivElement;

  beforeEach(() => {
    FakeIO.instances = [];
    (globalThis as any).IntersectionObserver = FakeIO;
    Object.defineProperty(document.documentElement, 'clientWidth', { value: 1200, configurable: true });
    Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
    rect = { left: 800, top: 40, width: 380, height: 700 };
    el = document.createElement('div');
    el.getBoundingClientRect = () => ({
      ...rect, x: rect.left, y: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height,
      toJSON() { return this; },
    }) as DOMRect;
  });

  afterEach(() => {
    (globalThis as any).IntersectionObserver = originalIO;
  });

  it('shrinks the root to exactly the element, so any move drops the ratio below 1', () => {
    observeMove(el, () => {});
    // top 40, right 1200-1180=20, bottom 800-740=60, left 800
    expect(latest().options.rootMargin).toBe('-40px -20px -60px -800px');
    expect(latest().options.threshold).toBe(1);
  });

  it('a pure translation calls onMove and re-arms at the new position', () => {
    const onMove = vi.fn();
    observeMove(el, onMove);
    latest().fire(1);                       // initial delivery: fully inside, nothing moved
    expect(onMove).not.toHaveBeenCalled();

    // Same size, shifted one column left — the Mosaic 3→4 tile reflow.
    rect = { ...rect, left: 410 };
    const armed = latest();
    armed.fire(0);
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(armed.disconnected).toBe(true);
    expect(latest()).not.toBe(armed);
    expect(latest().options.rootMargin).toBe('-40px -410px -60px -410px');
  });

  it('a partially clipped element re-arms at its visible ratio instead of reporting a move', () => {
    const onMove = vi.fn();
    observeMove(el, onMove);
    latest().fire(0.5);
    expect(onMove).not.toHaveBeenCalled();
    expect(latest().options.threshold).toBe(0.5);
  });

  it('does nothing for a zero-size element and arms once it has a size', () => {
    rect = { left: 0, top: 0, width: 0, height: 0 };
    const handle = observeMove(el, () => {});
    expect(FakeIO.instances).toHaveLength(0);
    rect = { left: 10, top: 10, width: 300, height: 200 };
    handle.refresh();
    expect(FakeIO.instances).toHaveLength(1);
  });

  it('refresh() at an unchanged position keeps the current observer', () => {
    const handle = observeMove(el, () => {});
    handle.refresh();
    expect(FakeIO.instances).toHaveLength(1);
  });

  it('disconnect() stops observing', () => {
    const handle = observeMove(el, () => {});
    handle.disconnect();
    expect(latest().disconnected).toBe(true);
  });
});
