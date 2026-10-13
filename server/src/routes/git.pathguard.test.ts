import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRelativeWithinBase } from '../utils/pathScope.js';
import { isSafeRef } from './git.js';

// Unit-test the two guard primitives used by git.ts — no HTTP server needed.

const BASE = '/home/u/repo';

// --- resolveRelativeWithinBase contract (path containment) ---

test('git guard: normal relative file accepted', () => {
  assert.ok(resolveRelativeWithinBase(BASE, 'src/index.ts'));
});

test('git guard: relative traversal escape rejected', () => {
  assert.equal(resolveRelativeWithinBase(BASE, '../../etc/passwd'), null);
});

test('git guard: absolute path outside base rejected', () => {
  assert.equal(resolveRelativeWithinBase(BASE, '/etc/passwd'), null);
});

test('git guard: absolute path inside base accepted', () => {
  assert.ok(resolveRelativeWithinBase(BASE, `${BASE}/src/a.ts`));
});

test('git guard: empty string rejected', () => {
  assert.equal(resolveRelativeWithinBase(BASE, ''), null);
});

// --- isSafeRef contract (branch names) ---

test('ref guard: normal branch name accepted', () => {
  assert.ok(isSafeRef('feature/my-branch'));
});

test('ref guard: leading-dash option injection rejected', () => {
  assert.equal(isSafeRef('--force'), false);
  assert.equal(isSafeRef('-u'), false);
});

test('ref guard: dotdot traversal rejected', () => {
  assert.equal(isSafeRef('main..evil'), false);
});

test('ref guard: tag-style name accepted', () => {
  assert.ok(isSafeRef('v1.2.3'));
});

// --- S8: git-pull-and-branch baseBranch (went straight into `git checkout`) ---

test('git-pull-and-branch rejects option-like baseBranch / branchName before calling git', async () => {
  const express = (await import('express')).default;
  const { createGitRoutes } = await import('./git.js');
  const calls: unknown[] = [];
  const manager = { getSessionInfo: () => ({ id: 's', folderPath: '/tmp/repo' }) };
  const gitService = { pullAndBranch: async (...a: unknown[]) => { calls.push(a); return { success: true }; } };
  const app = express();
  app.use(express.json());
  app.use('/api', createGitRoutes(manager as never, gitService as never, {} as never, {} as never));
  const server = await new Promise<import('http').Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const port = (server.address() as import('net').AddressInfo).port;
  const post = (body: unknown) => fetch(`http://127.0.0.1:${port}/api/sessions/s/git-pull-and-branch`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    for (const body of [
      { branchName: 'feat/x', baseBranch: '--orphan=evil' },
      { branchName: 'feat/x', baseBranch: '-f' },
      { branchName: 'feat/x', baseBranch: 'main..HEAD' },
      { branchName: 'feat/x', baseBranch: 42 },
      { branchName: '-D' },
    ]) {
      assert.equal((await post(body)).status, 400, JSON.stringify(body));
    }
    assert.deepEqual(calls, []);
    assert.equal((await post({ branchName: 'feat/x', baseBranch: 'main' })).status, 200);
    assert.equal((await post({ branchName: 'feat/x' })).status, 200);
    assert.equal(calls.length, 2);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
