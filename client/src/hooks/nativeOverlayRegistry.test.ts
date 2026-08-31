import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerOverlay, unregisterOverlay, suppress,
  setSuppressionTransport, resetOverlayRegistryForTests,
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
