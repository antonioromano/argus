import { describe, it, expect } from 'vitest';
import { putTabState, dropTabState, tabStateFor, dirtyByPath, type TabStates } from './tabStates.js';
import type { TabBufferSnapshot } from './EditorTab.js';

const snap = (dirty: boolean, tag = ''): TabBufferSnapshot => ({
  dirty, saving: false, loading: false, error: tag || null, conflict: false,
  save: async () => {}, reload: async () => {},
});

describe('tab states with the same file open in both split groups', () => {
  it('closing one of two tabs on the same path keeps the other tab\'s dirty state and save', () => {
    let s: TabStates = {};
    s = putTabState(s, 'a.ts', 'left', snap(true, 'left'));
    s = putTabState(s, 'a.ts', 'right', snap(true, 'right'));

    s = dropTabState(s, 'a.ts', 'right');

    expect(dirtyByPath(s)).toEqual({ 'a.ts': true });
    // ⌘S must target the surviving tab's buffer, not the unmounted one.
    expect(tabStateFor(s, 'a.ts')?.error).toBe('left');
  });

  it('forgets the path once the last tab showing it unmounts', () => {
    let s: TabStates = {};
    s = putTabState(s, 'a.ts', 'left', snap(true));
    s = putTabState(s, 'a.ts', 'right', snap(false));
    s = dropTabState(s, 'a.ts', 'left');
    s = dropTabState(s, 'a.ts', 'right');
    expect(s).toEqual({});
    expect(tabStateFor(s, 'a.ts')).toBeUndefined();
  });

  it('is dirty while any tab on the path is dirty; the latest report drives the chrome', () => {
    let s: TabStates = {};
    s = putTabState(s, 'a.ts', 'left', snap(true, 'left'));
    s = putTabState(s, 'a.ts', 'right', snap(false, 'right'));
    expect(dirtyByPath(s)['a.ts']).toBe(true);
    expect(tabStateFor(s, 'a.ts')?.error).toBe('right');
    s = putTabState(s, 'a.ts', 'left', snap(true, 'left2'));
    expect(tabStateFor(s, 'a.ts')?.error).toBe('left2');
  });

  it('dropping an unknown tab is a no-op (same object)', () => {
    const s: TabStates = putTabState({}, 'a.ts', 'left', snap(false));
    expect(dropTabState(s, 'a.ts', 'nope')).toBe(s);
    expect(dropTabState(s, 'b.ts', 'left')).toBe(s);
  });
});
