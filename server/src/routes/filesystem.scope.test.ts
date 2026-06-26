import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import { isBrowsablePath } from './filesystem.js';

// The folder picker must stay inside the home subtree or an already-managed
// session folder — never enumerate the whole filesystem for an authenticated
// (e.g. tunnel) client.
const home = os.homedir();

// A fake SessionManager whose only managed folder is /opt/managed-project.
const fakeSessionManager = {
  resolveWithinAnySession(rawPath: string): string | null {
    const base = '/opt/managed-project';
    const resolved = path.resolve(rawPath);
    return resolved === base || resolved.startsWith(base + path.sep) ? resolved : null;
  },
} as any;

test('allows the home directory itself', () => {
  assert.equal(isBrowsablePath(fakeSessionManager, home), true);
});

test('allows a path inside home', () => {
  assert.equal(isBrowsablePath(fakeSessionManager, path.join(home, 'dev', 'argus')), true);
});

test('expands ~ to home and allows it', () => {
  assert.equal(isBrowsablePath(fakeSessionManager, '~/projects'), true);
});

test('rejects a system directory outside home', () => {
  assert.equal(isBrowsablePath(fakeSessionManager, '/etc'), false);
});

test("rejects another user's home (sibling of home)", () => {
  const sibling = path.join(path.dirname(home), 'someone-else');
  assert.equal(isBrowsablePath(fakeSessionManager, sibling), false);
});

test('rejects the parent of home (would enumerate sibling homes)', () => {
  assert.equal(isBrowsablePath(fakeSessionManager, path.dirname(home)), false);
});

test('allows a managed session folder even when outside home', () => {
  assert.equal(isBrowsablePath(fakeSessionManager, '/opt/managed-project/src'), true);
});

test('rejects an unmanaged folder outside home', () => {
  assert.equal(isBrowsablePath(fakeSessionManager, '/opt/other'), false);
});
