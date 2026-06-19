import { describe, it, expect } from 'vitest';
import {
  maximizeSidePanelState,
  openMaximizedState,
  dismissMaximizedState,
  toggleSidePanelState,
  type AppViewState,
} from './useAppView.js';

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
