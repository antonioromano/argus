import { describe, it, expect } from 'vitest';
import {
  EMPTY_DISCOVERY, TIP_MIN_GAP_MS, hasUsed, markTipSeen, markUsed, normalizeDiscovery, resetTips, tipAllowed,
} from './discoveryState.js';

describe('normalizeDiscovery', () => {
  it('fills every field for undefined, {} and garbage', () => {
    for (const raw of [undefined, null, {}, 'x', 42, []]) {
      expect(normalizeDiscovery(raw)).toEqual(EMPTY_DISCOVERY);
    }
  });

  it('keeps what an older build wrote and fills the rest', () => {
    expect(normalizeDiscovery({ tipsSeen: ['broadcast'] })).toEqual({ ...EMPTY_DISCOVERY, tipsSeen: ['broadcast'] });
  });

  it('drops wrong types field by field', () => {
    const d = normalizeDiscovery({ tipsSeen: ['a', 1], tipLastShownAt: -5, notifAskedAt: 'x', checklistDismissed: 'yes', used: 'inbox' });
    expect(d.tipsSeen).toEqual(['a']);
    expect(d.tipLastShownAt).toBe(0);
    expect(d.notifAskedAt).toBe(0);
    expect(d.checklistDismissed).toBe(false);
    expect(d.used).toEqual([]);
  });
});

describe('markers', () => {
  it('markTipSeen records the id once and stamps the time', () => {
    const d = markTipSeen(markTipSeen(EMPTY_DISCOVERY, 'broadcast', 10), 'broadcast', 20);
    expect(d.tipsSeen).toEqual(['broadcast']);
    expect(d.tipLastShownAt).toBe(20);
  });

  it('markUsed is idempotent and returns the same object when nothing changes', () => {
    const once = markUsed(EMPTY_DISCOVERY, 'inbox');
    expect(hasUsed(once, 'inbox')).toBe(true);
    expect(markUsed(once, 'inbox')).toBe(once);
  });

  it('resetTips clears tips only', () => {
    const d = resetTips({ ...markUsed(markTipSeen(EMPTY_DISCOVERY, 'x', 5), 'inbox'), notifAskedAt: 9 });
    expect(d.tipsSeen).toEqual([]);
    expect(d.tipLastShownAt).toBe(0);
    expect(d.used).toEqual(['inbox']);
    expect(d.notifAskedAt).toBe(9);
  });
});

describe('tipAllowed', () => {
  const base = { now: 10 * TIP_MIN_GAP_MS, shownThisLaunch: 0, showTips: true };
  it('allows a first tip', () => {
    expect(tipAllowed(EMPTY_DISCOVERY, base)).toBe(true);
  });
  it('blocks when tips are off', () => {
    expect(tipAllowed(EMPTY_DISCOVERY, { ...base, showTips: false })).toBe(false);
  });
  it('allows one per launch', () => {
    expect(tipAllowed(EMPTY_DISCOVERY, { ...base, shownThisLaunch: 1 })).toBe(false);
  });
  it('needs a full hour since the last tip (59:59 no, 60:00 yes)', () => {
    const last = base.now - TIP_MIN_GAP_MS;
    expect(tipAllowed({ ...EMPTY_DISCOVERY, tipLastShownAt: last + 1000 }, base)).toBe(false);
    expect(tipAllowed({ ...EMPTY_DISCOVERY, tipLastShownAt: last }, base)).toBe(true);
  });
});
