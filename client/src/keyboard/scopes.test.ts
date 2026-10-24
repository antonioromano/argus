import { describe, it, expect, afterEach } from 'vitest';
import { registerScope, activeScopes, scopedHandler, createMenuEchoGuard } from './scopes.js';
import { resolveShortcuts, matchEvent } from './useShortcuts.js';
import { isMac } from '../utils/platform.js';

const cmdShiftF = () => new KeyboardEvent('keydown', { key: 'F', shiftKey: true, [isMac ? 'metaKey' : 'ctrlKey']: true });

let unregister: (() => void) | null = null;
afterEach(() => {
  unregister?.();
  unregister = null;
});

describe('scoped shortcut dispatch', () => {
  it('routes ⌘⇧F to Find in Files only while the explorer scope is active', () => {
    const resolved = resolveShortcuts();
    expect(matchEvent(cmdShiftF(), resolved, activeScopes())).toBe('session-search');

    let opened = 0;
    unregister = registerScope('explorer', { 'find-in-files': () => { opened++; } });
    const action = matchEvent(cmdShiftF(), resolved, activeScopes());
    expect(action).toBe('find-in-files');
    scopedHandler(action!)?.();
    expect(opened).toBe(1);

    // An overlay over the explorer passes no scopes: session search again.
    expect(matchEvent(cmdShiftF(), resolved, undefined)).toBe('session-search');

    unregister();
    unregister = null;
    expect(matchEvent(cmdShiftF(), resolved, activeScopes())).toBe('session-search');
    expect(scopedHandler('find-in-files')).toBeNull();
  });

  it('a stale unregister does not drop a newer registration of the scope', () => {
    const first = registerScope('explorer', { 'find-in-files': () => {} });
    const handler = () => {};
    unregister = registerScope('explorer', { 'find-in-files': handler });
    first();
    expect(scopedHandler('find-in-files')).toBe(handler);
  });
});

describe('menu echo guard', () => {
  it('drops the menu echo of a claimed keystroke but not a later menu click', () => {
    let t = 1000;
    const guard = createMenuEchoGuard(300, () => t);
    expect(guard.isEcho()).toBe(false); // a plain menu click
    guard.claim();
    t += 50;
    expect(guard.isEcho()).toBe(true); // accelerator echo of the handled ⌘⇧F
    t += 1000;
    expect(guard.isEcho()).toBe(false); // the user clicks the menu item later
  });
});
