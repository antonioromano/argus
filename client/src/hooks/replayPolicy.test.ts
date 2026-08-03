import { describe, it, expect } from 'vitest';
import { shouldPaintReplay, shouldRequestResync } from './replayPolicy.js';

describe('shouldPaintReplay', () => {
  it('paints a join frame even when the reader is scrolled up', () => {
    // A join frame is not optional: skipping it leaves the terminal blank.
    expect(shouldPaintReplay('join', true)).toBe(true);
    expect(shouldPaintReplay(undefined, true)).toBe(true);
  });

  it('skips an unsolicited refresh frame while the reader is scrolled up', () => {
    // Server-pushed, history-bearing, opens with ED 3 → would wipe their place.
    expect(shouldPaintReplay('refresh', true)).toBe(false);
    expect(shouldPaintReplay('refresh', false)).toBe(true);
  });

  it('paints a resync frame while the reader is scrolled up', () => {
    // Screen-only, no ED 3 — costs the reader nothing, so the guard does not apply.
    expect(shouldPaintReplay('resync', true)).toBe(true);
  });
});

describe('shouldRequestResync', () => {
  it('realigns a scrolled-up reader instead of abandoning them', () => {
    // The old destructive frame forced a choice between alignment and scroll
    // position. A screen-only frame does not, so being scrolled up is no longer
    // a reason to leave the screen drifted.
    expect(shouldRequestResync({ bufferType: 'normal', scrolledUp: true })).toBe(true);
  });

  it('realigns the normal buffer at the bottom', () => {
    expect(shouldRequestResync({ bufferType: 'normal', scrolledUp: false })).toBe(true);
  });

  it('never touches the alternate buffer', () => {
    // Alt-screen frames degrade to full ones server-side (they must re-emit the
    // buffer switch), so a resync there is exactly the flicker we are avoiding.
    expect(shouldRequestResync({ bufferType: 'alternate', scrolledUp: false })).toBe(false);
    expect(shouldRequestResync({ bufferType: 'alternate', scrolledUp: true })).toBe(false);
  });
});
