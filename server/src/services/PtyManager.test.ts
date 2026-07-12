import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import os from 'node:os';
import { shquote, tmuxSessionName, PtyManager } from './PtyManager.js';

test('shquote wraps a plain string in single quotes', () => {
  assert.equal(shquote('claude'), "'claude'");
});

test('shquote neutralizes embedded single quotes', () => {
  assert.equal(shquote("a'b"), "'a'\\''b'");
});

// The real contract: whatever shquote produces, the shell must echo back verbatim —
// no metacharacter (;, $, `, newline, spaces) may break out of the quoted word.
for (const payload of [
  'plain',
  'with space',
  'semi;colon',
  '$(whoami)',
  '`id`',
  "quote'inside",
  'a"b',
  'new\nline',
  '--flag=value with spaces',
]) {
  test(`shquote is shell-safe for: ${JSON.stringify(payload)}`, () => {
    const out = execFileSync('/bin/sh', ['-c', `printf %s ${shquote(payload)}`], { encoding: 'utf-8' });
    assert.equal(out, payload);
  });
}

test('tmuxSessionName prefixes with argus- and keeps UUIDs intact', () => {
  assert.equal(
    tmuxSessionName('3f8a1c2e-0000-4444-8888-abcabcabcabc'),
    'argus-3f8a1c2e-0000-4444-8888-abcabcabcabc',
  );
});

test('tmuxSessionName strips characters tmux would mishandle', () => {
  assert.equal(tmuxSessionName('a b:c.d/e'), 'argus-abcde');
});

// Session names below are unique per test run and torn down via killTmuxSession
// (never killTmuxServer) — safe to run against a real tmux server that may also
// be hosting live Argus sessions on the shared "argus" socket.
test('detachTmuxClients on a nonexistent session is a safe no-op', () => {
  const pm = new PtyManager();
  if (!pm.isTmuxAvailable()) return;
  assert.doesNotThrow(() => pm.detachTmuxClients('argus-test-does-not-exist'));
});

test('detachTmuxClients evicts a stale client without killing the session', async (t) => {
  const pm = new PtyManager();
  if (!pm.isTmuxAvailable()) return;
  const name = `argus-test-detach-${process.pid}-${Date.now()}`;
  t.after(() => pm.killTmuxSession(name));

  const client = pm.spawnTmux(name, os.tmpdir(), 'cat');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(pm.hasTmuxSession(name), true);

  const exited = new Promise<void>((resolve) => client.onExit(() => resolve()));
  pm.detachTmuxClients(name);
  await exited;

  assert.equal(pm.hasTmuxSession(name), true, 'session survives client eviction');
});

test('spawnTmux evicts an orphaned client left by a prior run before reattaching', async (t) => {
  const pm = new PtyManager();
  if (!pm.isTmuxAvailable()) return;
  const name = `argus-test-reattach-${process.pid}-${Date.now()}`;
  t.after(() => pm.killTmuxSession(name));

  const orphan = pm.spawnTmux(name, os.tmpdir(), 'cat');
  await new Promise((resolve) => setTimeout(resolve, 300));

  const orphanExited = new Promise<void>((resolve) => orphan.onExit(() => resolve()));
  const reattached = pm.spawnTmux(name, os.tmpdir(), 'cat');
  await orphanExited;

  assert.equal(pm.hasTmuxSession(name), true);
  reattached.kill();
});
