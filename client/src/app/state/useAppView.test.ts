import { describe, it, expect } from 'vitest';
import {
  maximizeSidePanelState,
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
