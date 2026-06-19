import { describe, it, expect } from 'vitest';
import {
  maximizeSidePanelState,
  restoreSidePanelState,
  toggleSidePanelState,
  type AppViewState,
} from './useAppView.js';

const base: AppViewState = {
  view: 'focus',
  activeSessionId: 's1',
  overlay: null,
  sidePanel: null,
};

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

  it('restore drops the maximized flag, keeping kind + session + target', () => {
    const maxed = maximizeSidePanelState(base, { kind: 'explorer', sessionId: 's1', filePath: 'src/a.ts' });
    const next = restoreSidePanelState(maxed);
    expect(next.sidePanel).toEqual({ kind: 'explorer', sessionId: 's1', maximized: false, filePath: 'src/a.ts' });
  });

  it('restore is a no-op when nothing is maximized', () => {
    const docked: AppViewState = { ...base, sidePanel: { kind: 'diff', sessionId: 's1' } };
    expect(restoreSidePanelState(docked)).toBe(docked);
  });

  it('restore is a no-op for the terminal panel', () => {
    const term: AppViewState = { ...base, sidePanel: { kind: 'terminal', sessionId: 's1' } };
    expect(restoreSidePanelState(term)).toBe(term);
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
