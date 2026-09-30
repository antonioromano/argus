import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  registerOverlay, unregisterOverlay, suppress, suppressLive,
  setSuppressionTransport, resetOverlayRegistryForTests,
  isFullScreenSuppressed, subscribeFullScreenSuppression,
  isOverlayHidden, subscribeOverlayHidden,
} from './nativeOverlayRegistry.js';

const A = { x: 0, y: 0, width: 100, height: 100 };
const B = { x: 200, y: 0, width: 100, height: 100 };

let hidden: string[];
let shown: string[];
beforeEach(() => {
  resetOverlayRegistryForTests();
  hidden = []; shown = [];
  setSuppressionTransport({ hide: (id) => hidden.push(id), show: (id) => shown.push(id) });
});

describe('nativeOverlayRegistry', () => {
  it('suppresses only overlays the surface actually overlaps', () => {
    registerOverlay('a', A);
    registerOverlay('b', B);
    const got = suppress({ x: 50, y: 50, width: 20, height: 20 });   // inside A only
    expect(got.ids).toEqual(['a']);
    expect(hidden).toEqual(['a']);
  });

  it("suppresses everything for a full-screen surface", () => {
    registerOverlay('a', A);
    registerOverlay('b', B);
    expect(suppress('all').ids.sort()).toEqual(['a', 'b']);
  });

  it('refcounts: a second overlapping surface does not re-hide, and the first release does not restore', () => {
    registerOverlay('a', A);
    const s1 = suppress('all');
    const s2 = suppress('all');
    expect(hidden).toEqual(['a']);          // hidden once, not twice
    s1.release();
    expect(shown).toEqual([]);              // still one holder
    s2.release();
    expect(shown).toEqual(['a']);           // now restored
  });

  it('an overlay registered while suppressed is hidden immediately', () => {
    const s = suppress('all');
    registerOverlay('late', A);
    expect(hidden).toEqual(['late']);
    s.release();
    expect(shown).toEqual(['late']);
  });

  it('an overlay registered under two active full-screen suppressions stays hidden until both release', () => {
    const s1 = suppress('all');
    const s2 = suppress('all');
    registerOverlay('late', A);
    expect(hidden).toEqual(['late']);
    s1.release();
    expect(shown).toEqual([]);              // s2 still holds it
    s2.release();
    expect(shown).toEqual(['late']);
  });

  it('unregistering a suppressed overlay does not later show a dead overlay', () => {
    registerOverlay('a', A);
    const s = suppress('all');
    unregisterOverlay('a');
    s.release();
    expect(shown).toEqual([]);
  });

  it('repeated registerOverlay for the same id under one suppression holds only once', () => {
    const s = suppress('all');
    registerOverlay('a', A);
    registerOverlay('a', { ...A, x: 10 });
    registerOverlay('a', { ...A, x: 20 });
    expect(hidden).toEqual(['a']);          // hide fired once, not three times
    s.release();
    expect(shown).toEqual(['a']);           // shown fired once
    // Genuinely released, not still held: a fresh suppression must be able
    // to hide it again from scratch.
    suppress('all');
    expect(hidden).toEqual(['a', 'a']);
  });

  it('unregistering and re-registering under two active suppressions does not let one release both', () => {
    const s1 = suppress('all');
    const s2 = suppress('all');
    registerOverlay('a', A);
    unregisterOverlay('a');
    registerOverlay('a', A);
    s1.release();
    expect(shown).toEqual([]);              // s2 must still be holding it
    s2.release();
    expect(shown).toEqual(['a']);           // now released exactly once
  });

  it('touching edges do not count as an overlap', () => {
    registerOverlay('a', A);          // 0..100
    expect(suppress({ x: 100, y: 0, width: 10, height: 10 }).ids).toEqual([]);
  });
});

describe('full-screen suppression state', () => {
  it('reports open while any suppress("all") handle is held and notifies on each change', () => {
    resetOverlayRegistryForTests();
    const seen: boolean[] = [];
    const off = subscribeFullScreenSuppression(() => seen.push(isFullScreenSuppressed()));
    const a = suppress('all');
    const b = suppress('all');
    a.release();
    expect(isFullScreenSuppressed()).toBe(true);
    b.release();
    expect(isFullScreenSuppressed()).toBe(false);
    expect(seen).toEqual([true, true, true, false]);
    off();
  });

  it('does not count a partial-rect suppression as full-screen', () => {
    resetOverlayRegistryForTests();
    const h = suppress({ x: 0, y: 0, width: 10, height: 10 });
    expect(isFullScreenSuppressed()).toBe(false);
    h.release();
  });
});

describe('live partial suppression (suppressLive)', () => {
  const CARD = { x: 120, y: 0, width: 60, height: 100 };    // between A and B: overlaps nothing
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const flushFrame = () => vi.advanceTimersByTime(50);

  it('hides what the rect covers at creation, like suppress(rect)', () => {
    registerOverlay('a', A);
    registerOverlay('b', B);
    const h = suppressLive(() => ({ x: 50, y: 0, width: 200, height: 10 }));
    expect(hidden.sort()).toEqual(['a', 'b']);
    h.release();
    expect(shown.sort()).toEqual(['a', 'b']);
  });

  it('an overlay registered after the handle, intersecting its rect, is hidden immediately', () => {
    const h = suppressLive(() => CARD);
    registerOverlay('late', { x: 150, y: 50, width: 100, height: 100 });
    expect(hidden).toEqual(['late']);
    registerOverlay('far', { x: 400, y: 0, width: 50, height: 50 });
    expect(hidden).toEqual(['late']);
    h.release();
    expect(shown).toEqual(['late']);
  });

  it('an overlay whose geometry moves into the rect is hidden; moving out unhides it', () => {
    registerOverlay('a', A);
    const h = suppressLive(() => CARD);
    expect(hidden).toEqual([]);
    registerOverlay('a', { x: 120, y: 0, width: 100, height: 100 });   // reflow into the card
    expect(hidden).toEqual(['a']);
    registerOverlay('a', { x: 120, y: 0, width: 100, height: 100 });   // repeat report: no double hold
    registerOverlay('a', A);                                            // moves back out
    expect(shown).toEqual(['a']);
    h.release();
    expect(shown).toEqual(['a']);                                       // not shown twice
  });

  it('re-evaluates on window resize (rAF-throttled) when the rect moves', () => {
    registerOverlay('a', A);
    registerOverlay('b', B);
    let rect = CARD;
    const h = suppressLive(() => rect);
    expect(hidden).toEqual([]);
    rect = { x: 50, y: 0, width: 20, height: 20 };                      // window narrowed: card over A
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('resize'));
    expect(hidden).toEqual([]);                                         // not until the frame
    flushFrame();
    expect(hidden).toEqual(['a']);
    rect = { x: 250, y: 0, width: 20, height: 20 };                     // now over B only
    window.dispatchEvent(new Event('resize'));
    flushFrame();
    expect(hidden).toEqual(['a', 'b']);
    expect(shown).toEqual(['a']);
    h.release();
    expect(shown).toEqual(['a', 'b']);
  });

  it('refresh() re-evaluates a changed rect on the next frame', () => {
    registerOverlay('a', A);
    let rect: { x: number; y: number; width: number; height: number } | null = null;
    const h = suppressLive(() => rect);
    rect = { x: 0, y: 0, width: 10, height: 10 };
    h.refresh();
    flushFrame();
    expect(hidden).toEqual(['a']);
    expect(h.ids).toEqual(['a']);
    h.release();
  });

  it('release unhides everything it holds and stops tracking', () => {
    registerOverlay('a', A);
    registerOverlay('b', B);
    const h = suppressLive(() => ({ x: 0, y: 0, width: 300, height: 10 }));
    h.release();
    h.release();                                                        // idempotent
    expect(shown.sort()).toEqual(['a', 'b']);
    registerOverlay('c', { x: 0, y: 0, width: 10, height: 10 });
    window.dispatchEvent(new Event('resize'));
    flushFrame();
    expect(hidden.sort()).toEqual(['a', 'b']);
  });

  it('composes with other suppressions via the refcount', () => {
    registerOverlay('a', A);
    const s = suppress('all');
    const h = suppressLive(() => ({ x: 0, y: 0, width: 10, height: 10 }));
    s.release();
    expect(shown).toEqual([]);                                          // live handle still holds it
    registerOverlay('a', B);                                            // moves out from under the card
    expect(shown).toEqual(['a']);
    h.release();
  });

  it('an unregistered overlay leaves the handle; re-registering outside the rect is not held', () => {
    registerOverlay('a', A);
    const h = suppressLive(() => ({ x: 0, y: 0, width: 10, height: 10 }));
    unregisterOverlay('a');
    registerOverlay('a', B);
    expect(h.ids).toEqual([]);
    h.release();
    expect(shown).toEqual([]);
  });
});

// A hidden native overlay leaves its tile blank unless the tile draws a
// placeholder. Tiles need to know when THEIR overlay is hidden by any kind of
// suppression (full-screen, partial rect, or live), not only full-screen.
describe('per-overlay hidden state', () => {
  it('reports a tile hidden by a partial-rect suppression, and not its uncovered neighbour', () => {
    registerOverlay('a', A); registerOverlay('b', B);
    const h = suppress({ x: 10, y: 10, width: 20, height: 20 });
    expect(isOverlayHidden('a')).toBe(true);
    expect(isOverlayHidden('b')).toBe(false);
    h.release();
    expect(isOverlayHidden('a')).toBe(false);
  });

  it('reports a tile hidden by a live suppression and clears when the surface moves away', () => {
    registerOverlay('a', A);
    let rect: typeof A | null = { x: 10, y: 10, width: 20, height: 20 };
    const h = suppressLive(() => rect);
    expect(isOverlayHidden('a')).toBe(true);
    rect = { x: 500, y: 500, width: 10, height: 10 };
    registerOverlay('a', A); // a geometry report re-evaluates live handles
    expect(isOverlayHidden('a')).toBe(false);
    h.release();
  });

  it('notifies subscribers only when some overlay flips between shown and hidden', () => {
    registerOverlay('a', A);
    let calls = 0;
    const off = subscribeOverlayHidden(() => { calls++; });
    const h1 = suppress({ x: 0, y: 0, width: 10, height: 10 });
    const h2 = suppress({ x: 0, y: 0, width: 10, height: 10 }); // refcount 2: no flip
    expect(calls).toBe(1);
    h1.release();                                              // still held: no flip
    expect(calls).toBe(1);
    h2.release();                                              // shown again
    expect(calls).toBe(2);
    expect(isOverlayHidden('a')).toBe(false);
    off();
  });

  it('full-screen suppression marks every registered tile hidden', () => {
    registerOverlay('a', A); registerOverlay('b', B);
    const h = suppress('all');
    expect(isOverlayHidden('a') && isOverlayHidden('b')).toBe(true);
    h.release();
    expect(isOverlayHidden('a') || isOverlayHidden('b')).toBe(false);
  });

  it('unregistering a hidden overlay clears its hidden state and notifies', () => {
    registerOverlay('a', A);
    let calls = 0;
    const off = subscribeOverlayHidden(() => { calls++; });
    const h = suppress({ x: 0, y: 0, width: 10, height: 10 });
    unregisterOverlay('a');
    expect(isOverlayHidden('a')).toBe(false);
    expect(calls).toBe(2);
    h.release();
    off();
  });
});
