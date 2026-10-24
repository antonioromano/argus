import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { isCommitHash, isLogRef } from './git.js';
import { GitUnknownRefError } from '../services/GitService.js';

test('isCommitHash: hex only, 4–64 chars', () => {
  for (const ok of ['abcd', 'e4a25a2', 'A'.repeat(40), 'f'.repeat(64)]) assert.ok(isCommitHash(ok), ok);
  for (const bad of ['', 'abc', 'g1234', '--all', 'HEAD', 'abcd~1', 'abcd..ef01', 'f'.repeat(65)]) {
    assert.equal(isCommitHash(bad), false, bad);
  }
});

test('isLogRef: any valid refname plus ancestry; no options, ranges, reflog, pathspec or globs', () => {
  for (const ok of ['HEAD', 'main', 'origin/feat/x', 'v1.2.3', 'release-1_0', 'HEAD~3', 'main^2', 'main~', 'claude/b5+fix',
    'user@feature', 'fix/café', 'a;b', 'issue#12', 'refs/heads/side']) {
    assert.ok(isLogRef(ok), ok);
  }
  for (const bad of ['', '-n1', '--output=/tmp/x', 'main..evil', 'main...x', 'HEAD@{1}', '@', ':(top)x', 'a b', 'tag: v1', 'a~b',
    'feat*', 'x[1]', 'a\\b', 'a//b', 'feat/', 'main.', '.hidden', 'feat/.x', 'x.lock', 'a\tb', 'x'.repeat(256)]) {
    assert.equal(isLogRef(bad), false, bad);
  }
});

test('git-history / git-commit-detail / git-refs validate before calling git', async () => {
  const express = (await import('express')).default;
  const { createGitRoutes } = await import('./git.js');
  const calls: string[] = [];
  const repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'argus-route-')));
  mkdirSync(path.join(repo, 'src'));
  const manager = { getSessionInfo: (id: string) => (id === 's' ? { id: 's', folderPath: repo } : null) };
  const gitService = {
    history: async (_f: string, o: { ref?: string }) => {
      calls.push(`history ${JSON.stringify(o)}`);
      if (o.ref === 'gone') throw new GitUnknownRefError('gone');
      if (o.ref === 'slow') throw new Error('timed out');
      return { commits: [], hasMore: false };
    },
    commitDetail: async (_f: string, h: string) => { calls.push(`detail ${h}`); return h === 'abcd1234' ? { hash: h } : null; },
    refs: async () => { calls.push('refs'); return null; },
  };
  const app = express();
  app.use('/api', createGitRoutes(manager as never, gitService as never, {} as never, {} as never));
  const server = await new Promise<import('http').Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const port = (server.address() as import('net').AddressInfo).port;
  const get = (p: string) => fetch(`http://127.0.0.1:${port}/api/sessions/${p}`);
  try {
    for (const q of ['skip=-1', 'limit=0', 'skip=1.5', 'limit=abc', 'ref=--all', 'ref=a..b', `ref=${encodeURIComponent('HEAD@{2}')}`,
      `path=${encodeURIComponent('../../etc')}`, `path=${encodeURIComponent('/etc/passwd')}`]) {
      assert.equal((await get(`s/git-history?${q}`)).status, 400, q);
    }
    assert.equal((await get('s/git-commit-detail/--stat')).status, 400);
    assert.equal((await get('s/git-commit-detail/HEAD')).status, 400);
    assert.deepEqual(calls, []);

    assert.equal((await get('s/git-history?skip=50&limit=25&ref=origin%2Fmain')).status, 200);
    assert.equal(calls.pop(), 'history {"skip":50,"limit":25,"ref":"origin/main"}');
    assert.equal((await get('s/git-history')).status, 200);
    assert.equal(calls.pop(), 'history {"skip":0,"limit":50}');
    assert.equal((await get('s/git-history?path=src%2F')).status, 200);
    assert.equal(calls.pop(), 'history {"skip":0,"limit":50,"path":"src"}');
    // An unknown ref is the caller's mistake; any other git failure is ours.
    const gone = await get('s/git-history?ref=gone');
    assert.equal(gone.status, 400);
    assert.deepEqual(await gone.json(), { error: 'Unknown ref: gone' });
    assert.equal((await get('s/git-history?ref=slow')).status, 500);
    assert.equal((await get('s/git-commit-detail/abcd1234')).status, 200);
    assert.equal((await get('s/git-commit-detail/abcd9999')).status, 404);
    assert.equal((await get('s/git-refs')).status, 200);
    assert.equal((await get('other/git-refs')).status, 404);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(repo, { recursive: true, force: true });
  }
});
