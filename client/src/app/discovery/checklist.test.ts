import { describe, it, expect } from 'vitest';
import { autoDone, checklistVisible, newlyDone, openChecklistState, type ChecklistSignals } from './checklist.js';
import { EMPTY_DISCOVERY, markUsed } from './discoveryState.js';

const base: ChecklistSignals = { liveCount: 1, discovery: EMPTY_DISCOVERY, notificationsEnabled: false, tunnelStatus: undefined };

describe('autoDone', () => {
  it('ticks each item from its real signal', () => {
    expect(autoDone(base)).toEqual([]);
    expect(autoDone({ ...base, liveCount: 2 })).toEqual(['two-sessions']);
    expect(autoDone({ ...base, discovery: markUsed(EMPTY_DISCOVERY, 'inbox') })).toEqual(['inbox']);
    expect(autoDone({ ...base, notificationsEnabled: true })).toEqual(['notifications']);
    expect(autoDone({ ...base, tunnelStatus: 'connected' })).toEqual(['remote']);
    expect(autoDone({ ...base, tunnelStatus: 'connecting' })).toEqual([]);
  });

  it('is sticky: closing a session does not untick', () => {
    const d = { ...EMPTY_DISCOVERY, checklistDone: ['two-sessions'] };
    expect(autoDone({ ...base, liveCount: 0, discovery: d })).toEqual(['two-sessions']);
  });
});

describe('newlyDone', () => {
  it('returns the merged list only when something new was ticked', () => {
    const d = { ...EMPTY_DISCOVERY, checklistDone: ['inbox'] };
    expect(newlyDone({ ...base, discovery: d })).toBeNull();
    expect(newlyDone({ ...base, discovery: d, liveCount: 2 })).toEqual(['inbox', 'two-sessions']);
  });
});

describe('checklistVisible', () => {
  it('hidden unless started, not dismissed, not all done', () => {
    expect(checklistVisible(EMPTY_DISCOVERY), 'never started (upgrading user)').toBe(false);
    const started = { ...EMPTY_DISCOVERY, checklistStartedAt: 1 };
    expect(checklistVisible(started)).toBe(true);
    expect(checklistVisible({ ...started, checklistDismissed: true })).toBe(false);
    expect(checklistVisible({ ...started, checklistDone: ['two-sessions', 'inbox', 'notifications', 'remote'] })).toBe(false);
  });

  it('openChecklistState starts it once and un-hides it', () => {
    const opened = openChecklistState({ ...EMPTY_DISCOVERY, checklistDismissed: true }, 50);
    expect(opened.checklistStartedAt).toBe(50);
    expect(opened.checklistDismissed).toBe(false);
    expect(openChecklistState({ ...EMPTY_DISCOVERY, checklistStartedAt: 7 }, 50).checklistStartedAt).toBe(7);
  });
});
