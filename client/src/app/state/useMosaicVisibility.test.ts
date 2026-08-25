import { describe, it, expect, beforeEach, vi } from 'vitest';
import { storageKey, loadMinimized, computeIsMinimized } from './useMosaicVisibility.js';

// Node 22 ships a global `localStorage` that throws without --localstorage-file,
// and jsdom's window.localStorage is shadowed here, so install a Map-backed fake.
// (Same pattern as useEditorGroups.test.ts.)
function installFakeLocalStorage() {
  const store = new Map<string, string>();
  const fake: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    key: (i) => [...store.keys()][i] ?? null,
    removeItem: (k) => void store.delete(k),
    setItem: (k, v) => void store.set(k, String(v)),
  };
  vi.stubGlobal('window', { ...(globalThis.window ?? {}), localStorage: fake });
  vi.stubGlobal('localStorage', fake);
}

describe('storageKey', () => {
  it('namespaces by window id', () => {
    expect(storageKey('main')).toBe('mosaic-minimized:main');
    expect(storageKey('w-123')).toBe('mosaic-minimized:w-123');
  });
});

describe('loadMinimized', () => {
  beforeEach(() => installFakeLocalStorage());

  it('returns empty set when nothing stored', () => {
    expect(loadMinimized('main')).toEqual(new Set());
    expect(loadMinimized('w-2')).toEqual(new Set());
  });

  it('reads the per-window key when present', () => {
    localStorage.setItem(storageKey('w-2'), JSON.stringify(['a', 'b']));
    expect(loadMinimized('w-2')).toEqual(new Set(['a', 'b']));
  });

  it('falls back to the legacy pre-multi-window key for main only', () => {
    localStorage.setItem('mosaic-minimized', JSON.stringify(['legacy1', 'legacy2']));
    expect(loadMinimized('main')).toEqual(new Set(['legacy1', 'legacy2']));
    // Secondary windows never had a legacy key — no fallback for them.
    expect(loadMinimized('w-2')).toEqual(new Set());
  });

  it('prefers the per-window key over the legacy fallback when both exist (main)', () => {
    localStorage.setItem('mosaic-minimized', JSON.stringify(['legacy']));
    localStorage.setItem(storageKey('main'), JSON.stringify(['scoped']));
    expect(loadMinimized('main')).toEqual(new Set(['scoped']));
  });

  it('recovers from malformed JSON', () => {
    localStorage.setItem(storageKey('main'), '{not json');
    expect(loadMinimized('main')).toEqual(new Set());
  });

  it('recovers from valid JSON that is not an array, and drops non-string entries', () => {
    localStorage.setItem(storageKey('main'), JSON.stringify({ nope: true }));
    expect(loadMinimized('main')).toEqual(new Set());

    localStorage.setItem(storageKey('w-3'), JSON.stringify(['a', 1, null, 'b']));
    expect(loadMinimized('w-3')).toEqual(new Set(['a', 'b']));
  });
});

describe('computeIsMinimized — ownership clause', () => {
  const noForce = { group: null, ids: new Set<string>() };

  it('a foreign session is always minimized, no matter the group filter or force-show', () => {
    const isForeign = (id: string) => id === 'foreign-1';

    // No group filter, not hand-minimized: would normally be visible.
    expect(computeIsMinimized('foreign-1', null, null, new Set(), noForce, isForeign)).toBe(true);

    // Group filter includes it: would normally be visible.
    const filterIncludes = new Set(['foreign-1']);
    expect(computeIsMinimized('foreign-1', filterIncludes, 'g1', new Set(), noForce, isForeign)).toBe(true);

    // Force-shown via chip click: would normally override the group filter.
    const forced = { group: 'g1', ids: new Set(['foreign-1']) };
    expect(computeIsMinimized('foreign-1', new Set(), 'g1', new Set(), forced, isForeign)).toBe(true);
  });

  it('a non-foreign session with no group filter follows the hand-minimize set', () => {
    const notForeign = () => false;
    expect(computeIsMinimized('s1', null, null, new Set(['s1']), noForce, notForeign)).toBe(true);
    expect(computeIsMinimized('s1', null, null, new Set(), noForce, notForeign)).toBe(false);
  });

  it('a non-foreign session under a group filter is minimized unless a member or force-shown', () => {
    const notForeign = () => false;
    const filterIds = new Set(['s1']);

    // Member of the active filter group: visible.
    expect(computeIsMinimized('s1', filterIds, 'g1', new Set(), noForce, notForeign)).toBe(false);
    // Not a member, not force-shown: minimized, even if hand-minimize set says otherwise.
    expect(computeIsMinimized('s2', filterIds, 'g1', new Set(), noForce, notForeign)).toBe(true);
    // Not a member but force-shown for this exact group: visible.
    const forced = { group: 'g1', ids: new Set(['s2']) };
    expect(computeIsMinimized('s2', filterIds, 'g1', new Set(), forced, notForeign)).toBe(false);
    // Force-shown ids tagged to a different group don't carry over.
    const forcedOtherGroup = { group: 'g2', ids: new Set(['s2']) };
    expect(computeIsMinimized('s2', filterIds, 'g1', new Set(), forcedOtherGroup, notForeign)).toBe(true);
  });
});
