import { describe, it, expect } from 'vitest';
import { snapshotKeys } from './configSnapshot.js';

describe('snapshotKeys', () => {
  it('returns a patch of just the named keys', () => {
    const config = { theme: 'dark', fontSize: 13, notifications: true };
    expect(snapshotKeys(config, ['theme', 'fontSize'])).toEqual({ theme: 'dark', fontSize: 13 });
  });

  it('deep-copies values so later edits to the config do not leak into the snapshot', () => {
    const config = { keyboardShortcuts: { newSession: 'Cmd+T' }, roots: ['/a'] };
    const snap = snapshotKeys(config, ['keyboardShortcuts', 'roots']);
    config.keyboardShortcuts.newSession = 'Cmd+N';
    config.roots.push('/b');
    expect(snap).toEqual({ keyboardShortcuts: { newSession: 'Cmd+T' }, roots: ['/a'] });
  });

  it('omits keys the config does not have', () => {
    const config: { a?: number; b: number } = { b: 2 };
    expect(snapshotKeys(config, ['a', 'b'])).toEqual({ b: 2 });
    expect('a' in snapshotKeys(config, ['a', 'b'])).toBe(false);
  });
});
