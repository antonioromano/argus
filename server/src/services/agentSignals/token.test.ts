import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';
import { computeSignalToken, verifySignalToken, getOrCreateSignalSecret } from './token.js';

test('computeSignalToken is deterministic per (secret, sessionId)', () => {
  const t1 = computeSignalToken('secret-a', 'sess-1');
  const t2 = computeSignalToken('secret-a', 'sess-1');
  assert.equal(t1, t2, 'same inputs → same token (survivor keeps a valid token across restart)');
  assert.equal(t1.length, 64, 'hex sha256');
});

test('computeSignalToken differs by session and by secret', () => {
  assert.notEqual(computeSignalToken('secret-a', 'sess-1'), computeSignalToken('secret-a', 'sess-2'));
  assert.notEqual(computeSignalToken('secret-a', 'sess-1'), computeSignalToken('secret-b', 'sess-1'));
});

test('verifySignalToken accepts a valid token', () => {
  const token = computeSignalToken('s', 'sess-1');
  assert.equal(verifySignalToken('s', 'sess-1', token), true);
});

test('verifySignalToken rejects a wrong token, wrong session, wrong secret', () => {
  const token = computeSignalToken('s', 'sess-1');
  assert.equal(verifySignalToken('s', 'sess-1', 'deadbeef'), false, 'wrong token');
  assert.equal(verifySignalToken('s', 'sess-2', token), false, 'token bound to another session');
  assert.equal(verifySignalToken('other', 'sess-1', token), false, 'wrong secret');
});

test('verifySignalToken rejects a length mismatch without throwing', () => {
  assert.equal(verifySignalToken('s', 'sess-1', ''), false);
  assert.equal(verifySignalToken('s', 'sess-1', 'short'), false);
});

test('getOrCreateSignalSecret generates once, persists, and re-reads the same secret', () => {
  const file = path.join(os.tmpdir(), `argus-signal-secret-${process.pid}-${Date.now()}`);
  try {
    const first = getOrCreateSignalSecret(file);
    assert.equal(first.length, 64, '32 random bytes as hex');
    const second = getOrCreateSignalSecret(file);
    assert.equal(second, first, 'stable across calls (deterministic tokens across restart)');
    const mode = statSync(file).mode & 0o777;
    assert.equal(mode, 0o600, 'secret file is owner-only');
  } finally {
    rmSync(file, { force: true });
  }
});
