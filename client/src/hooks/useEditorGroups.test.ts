import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadGroups, persistGroups } from './useEditorGroups.js';
import { isGroupsState, type GroupsState } from '../components/explorer/editorGroups.js';

const KEY = (sid: string) => `argus.explorer.tabs.${sid}`;

// Node 22 ships a global `localStorage` that throws without --localstorage-file,
// and jsdom's window.localStorage is shadowed here, so install a Map-backed fake.
// (In the real Electron renderer, window.localStorage is persistent and used.)
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
}

const sample: GroupsState = {
  groups: [
    { tabs: ['/repo/a.ts', '/repo/b.ts'], active: '/repo/b.ts', preview: null },
    { tabs: ['/repo/c.ts'], active: '/repo/c.ts', preview: null },
  ],
  focused: 1,
};

describe('isGroupsState', () => {
  it('accepts a well-formed state', () => {
    expect(isGroupsState(sample)).toBe(true);
  });
  it('rejects non-objects and malformed shapes', () => {
    expect(isGroupsState(null)).toBe(false);
    expect(isGroupsState('x')).toBe(false);
    expect(isGroupsState({ groups: [], focused: 0 })).toBe(false); // empty groups
    expect(isGroupsState({ groups: [{ tabs: [1], active: null, preview: null }], focused: 0 })).toBe(false); // non-string tab
    expect(isGroupsState({ groups: [{ tabs: [], active: null, preview: null }], focused: 5 })).toBe(false); // focused OOB
  });
});

describe('loadGroups / persistGroups round-trip', () => {
  beforeEach(() => installFakeLocalStorage());

  it('persists then hydrates the exact same state', () => {
    persistGroups('s1', sample);
    expect(loadGroups('s1')).toEqual(sample);
  });

  it('falls back to initGroups(initialPath) when nothing is stored', () => {
    expect(loadGroups('empty', '/repo/x.ts')).toEqual({
      groups: [{ tabs: ['/repo/x.ts'], active: '/repo/x.ts', preview: null }],
      focused: 0,
    });
  });

  it('opens initialPath into a restored layout without duplicating', () => {
    persistGroups('s2', sample);
    // b.ts already open in focused group 1 → no duplicate
    const already = loadGroups('s2', '/repo/c.ts');
    expect(already.groups[1].tabs.filter((t) => t === '/repo/c.ts')).toHaveLength(1);
    // a brand-new path gets opened into the focused group
    persistGroups('s3', sample);
    const opened = loadGroups('s3', '/repo/new.ts');
    expect(opened.groups[opened.focused].tabs).toContain('/repo/new.ts');
    expect(opened.groups[opened.focused].active).toBe('/repo/new.ts');
  });

  it('recovers from malformed JSON', () => {
    window.localStorage.setItem(KEY('bad'), '{not json');
    expect(loadGroups('bad', '/repo/y.ts')).toEqual({
      groups: [{ tabs: ['/repo/y.ts'], active: '/repo/y.ts', preview: null }],
      focused: 0,
    });
  });

  it('recovers from valid JSON with wrong shape', () => {
    window.localStorage.setItem(KEY('shape'), JSON.stringify({ groups: 'nope' }));
    expect(loadGroups('shape')).toEqual({ groups: [{ tabs: [], active: null, preview: null }], focused: 0 });
  });
});
