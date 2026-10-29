import { describe, it, expect, beforeEach } from 'vitest';
import {
  maximizeSidePanelState,
  openMaximizedState,
  dismissMaximizedState,
  toggleSidePanelState,
  loadPersistedView,
  persistView,
  type AppViewState,
} from './useAppView.js';
import { isMaximizedPanel } from '../types.js';

const base: AppViewState = {
  view: 'focus',
  activeSessionId: 's1',
  overlay: null,
  sidePanel: null,
  maximizedOrigin: null,
};
const dashboard: AppViewState = {
  view: 'dashboard',
  activeSessionId: null,
  overlay: null,
  sidePanel: null,
  maximizedOrigin: null,
};

describe('openMaximizedState (entry remembers origin)', () => {
  it('from the dashboard → focuses the session, maximizes, records origin=dashboard', () => {
    const next = openMaximizedState(dashboard, { kind: 'explorer', sessionId: 's2' });
    expect(next.view).toBe('focus');
    expect(next.activeSessionId).toBe('s2');
    expect(next.sidePanel).toEqual({ kind: 'explorer', sessionId: 's2', maximized: true });
    expect(next.maximizedOrigin).toBe('dashboard');
  });
  it('from focus → records origin=focus', () => {
    const next = openMaximizedState(base, { kind: 'diff', sessionId: 's1' });
    expect(next.maximizedOrigin).toBe('focus');
  });
  it('switching kind while already maximized keeps the original origin', () => {
    const opened = openMaximizedState(dashboard, { kind: 'explorer', sessionId: 's2' });
    const switched = openMaximizedState(opened, { kind: 'diff', sessionId: 's2' });
    expect(switched.maximizedOrigin).toBe('dashboard');
  });
  it('a PR diff opens like the other tool windows, carrying the PR it shows (B4)', () => {
    const pr = { url: 'https://github.com/o/r/pull/7', pr: null, folderBranch: false, linked: true };
    const next = openMaximizedState(dashboard, { kind: 'prdiff', sessionId: 's2', pr });
    expect(next.sidePanel).toEqual({ kind: 'prdiff', sessionId: 's2', pr, maximized: true });
    expect(next.view).toBe('focus');
    expect(dismissMaximizedState(next).view).toBe('dashboard');
  });
});

describe('dismissMaximizedState (close returns to origin)', () => {
  it('a dashboard-origin tool window closes back to the dashboard (mosaic)', () => {
    const opened = openMaximizedState(dashboard, { kind: 'explorer', sessionId: 's2' });
    const closed = dismissMaximizedState(opened);
    expect(closed.view).toBe('dashboard');
    expect(closed.sidePanel).toBeNull();
    expect(closed.maximizedOrigin).toBeNull();
  });
  it('a focus-origin tool window closes back to the shell (stays in focus)', () => {
    const opened = openMaximizedState(base, { kind: 'explorer', sessionId: 's1' });
    const closed = dismissMaximizedState(opened);
    expect(closed.view).toBe('focus');
    expect(closed.sidePanel).toBeNull();
    expect(closed.maximizedOrigin).toBeNull();
  });
});

describe('per-window view persistence across reload and relaunch (loadPersistedView / persistView)', () => {
  beforeEach(() => localStorage.clear());

  const DASH = { view: 'dashboard', activeSessionId: null, sidePanel: null, maximizedOrigin: null };
  const focus = (over: Partial<AppViewState> = {}): AppViewState => ({ ...base, ...over });

  it('round-trips a focused view with its docked panel', () => {
    persistView('main', focus({ activeSessionId: 's42', sidePanel: { kind: 'terminal', sessionId: 's42' } }));
    expect(loadPersistedView('main')).toEqual({
      view: 'focus', activeSessionId: 's42', sidePanel: { kind: 'terminal', sessionId: 's42' }, maximizedOrigin: null,
    });
  });

  it('round-trips a maximized tool window with its origin', () => {
    persistView('main', openMaximizedState(dashboard, { kind: 'explorer', sessionId: 's2' }));
    expect(loadPersistedView('main')).toEqual({
      view: 'focus', activeSessionId: 's2', sidePanel: { kind: 'explorer', sessionId: 's2', maximized: true }, maximizedOrigin: 'dashboard',
    });
  });

  it('keeps two windows apart', () => {
    persistView('main', focus({ activeSessionId: 'a' }));
    persistView('w2', focus({ activeSessionId: 'b' }));
    expect(loadPersistedView('main').activeSessionId).toBe('a');
    expect(loadPersistedView('w2').activeSessionId).toBe('b');
    expect(loadPersistedView('w3')).toEqual(DASH);
  });

  it('never restores a PR diff (it is opened from a fetched PR), nor a panel for another session', () => {
    const pr = { url: 'https://github.com/o/r/pull/7', pr: null, folderBranch: false, linked: true };
    persistView('main', openMaximizedState(base, { kind: 'prdiff', sessionId: 's1', pr }));
    expect(loadPersistedView('main').sidePanel).toBeNull();
    persistView('main', focus({ sidePanel: { kind: 'diff', sessionId: 'other' } }));
    expect(loadPersistedView('main')).toEqual({ ...DASH, view: 'focus', activeSessionId: 's1' });
  });

  it('clears the key when persisting a non-focus view', () => {
    persistView('main', focus());
    persistView('main', dashboard);
    expect(loadPersistedView('main')).toEqual(DASH);
  });

  it('does not persist a focus view without a session id', () => {
    persistView('main', focus({ activeSessionId: null }));
    expect(loadPersistedView('main')).toEqual(DASH);
  });

  it('ignores malformed stored JSON', () => {
    localStorage.setItem('argus.appView.main', '{not json');
    expect(loadPersistedView('main')).toEqual(DASH);
  });

  it('ignores a stored focus view missing its session id', () => {
    localStorage.setItem('argus.appView.main', JSON.stringify({ view: 'focus', activeSessionId: null }));
    expect(loadPersistedView('main')).toEqual(DASH);
  });
});

describe('side panel transitions', () => {
  it('maximize opens a maximized diff panel', () => {
    const next = maximizeSidePanelState(base, { kind: 'diff', sessionId: 's1' });
    expect(next.sidePanel).toEqual({ kind: 'diff', sessionId: 's1', maximized: true });
  });

  it('maximize carries the entry target (palette → explorer file/line/query)', () => {
    const next = maximizeSidePanelState(base, {
      kind: 'explorer', sessionId: 's1', filePath: 'src/a.ts', lineNumber: 42, query: 'foo',
    });
    expect(next.sidePanel).toEqual({
      kind: 'explorer', sessionId: 's1', maximized: true, filePath: 'src/a.ts', lineNumber: 42, query: 'foo',
    });
  });

  it('switching kind while maximized resets maximized to false (undefined flag)', () => {
    const maxed = maximizeSidePanelState(base, { kind: 'diff', sessionId: 's1' });
    const next = toggleSidePanelState(maxed, 'explorer', 's1');
    expect(next.sidePanel).toEqual({ kind: 'explorer', sessionId: 's1' });
    expect((next.sidePanel as { maximized?: boolean }).maximized).toBeUndefined();
  });

  it('toggling the same kind + session closes the panel', () => {
    const maxed = maximizeSidePanelState(base, { kind: 'diff', sessionId: 's1' });
    const next = toggleSidePanelState(maxed, 'diff', 's1');
    expect(next.sidePanel).toBeNull();
  });

  it('toggling the same kind on a different session opens fresh (not maximized)', () => {
    const maxed = maximizeSidePanelState(base, { kind: 'diff', sessionId: 's1' });
    const next = toggleSidePanelState(maxed, 'diff', 's2');
    expect(next.sidePanel).toEqual({ kind: 'diff', sessionId: 's2' });
  });
});

describe('isMaximizedPanel (Focus renders it full-view, Esc closes it)', () => {
  const pr = { url: 'https://github.com/o/r/pull/7', pr: null, folderBranch: false, linked: true };
  it('is true for every maximizable kind opened full-view, including the PR diff', () => {
    for (const panel of [
      { kind: 'diff', sessionId: 's1' },
      { kind: 'explorer', sessionId: 's1' },
      { kind: 'prdiff', sessionId: 's1', pr },
    ] as const) {
      expect(isMaximizedPanel(openMaximizedState(base, panel).sidePanel)).toBe(true);
    }
  });
  it('is false for docked panels, kinds without a full-view, and no panel', () => {
    expect(isMaximizedPanel({ kind: 'diff', sessionId: 's1' })).toBe(false);
    expect(isMaximizedPanel({ kind: 'terminal', sessionId: 's1' })).toBe(false);
    expect(isMaximizedPanel({ kind: 'activity', sessionId: 's1' })).toBe(false);
    expect(isMaximizedPanel(null)).toBe(false);
  });
});
