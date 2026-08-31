/* eslint-disable @typescript-eslint/no-explicit-any -- window bridge test shim */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openNativeFindBar } from './useTerminal.js';

// Regression guard for the task-6 bug where a repeat Cmd+F on a native tile
// silently stopped working after the user Escaped out of SwiftTerm's own
// find bar. Root cause: opening used to be driven by a React effect keyed on
// searchOpen's dependency array (see TerminalShell.tsx's git history) —
// SwiftTerm's find bar can be dismissed from INSIDE its own window with no
// callback back to JS, so searchOpen went stale (stuck `true`) and a second
// Cmd+F on the same tile never re-ran the effect. The fix decouples opening
// from any React state: ArgusApp.tsx's search action calls this function
// directly on every invocation. The one behavior worth pinning down here —
// so a future "avoid redundant calls" cleanup doesn't reintroduce exactly
// this bug — is that it must NEVER dedupe repeat calls for the same session.
describe('openNativeFindBar', () => {
  beforeEach(() => {
    delete (window as any).electronNativeTerminal;
  });

  it('issues the native open-find-bar IPC on every call, never deduped against a previous call for the same session', () => {
    const openFindBar = vi.fn();
    (window as any).electronNativeTerminal = { openFindBar };

    openNativeFindBar('s1');
    openNativeFindBar('s1'); // repeat, same session — must still reach the addon
    openNativeFindBar('s1');

    expect(openFindBar).toHaveBeenCalledTimes(3);
    expect(openFindBar.mock.calls).toEqual([['s1'], ['s1'], ['s1']]);
  });

  it('is inert when no native bridge is present (xterm-only session, or the addon never loaded)', () => {
    expect(() => openNativeFindBar('s1')).not.toThrow();
  });
});
