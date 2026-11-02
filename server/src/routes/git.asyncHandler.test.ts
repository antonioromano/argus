import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { SessionManager } from '../services/SessionManager.js';
import type { GitService } from '../services/GitService.js';
import type { ChangelistStore } from '../persistence/ChangelistStore.js';
import type { CommitSelectionStore } from '../persistence/CommitSelectionStore.js';
import { createGitRoutes } from './git.js';
import { errorHandler } from '../middleware/errorHandler.js';

// A rejected GitService call inside an async git route must be caught by
// asyncHandler and returned as a 500 through the terminal errorHandler, never hang.

let server: Server;
let base: string;

before(async () => {
  const manager = {
    getSessionInfo: (_id: string) => ({ id: _id, folderPath: '/tmp/repo' }),
  } as unknown as SessionManager;

  const gitService = {
    getDiff: async () => { throw new Error('git blew up'); },
    getBranches: async () => ({ branches: [], current: 'main' }),
  } as unknown as GitService;

  const changelistStore = {} as unknown as ChangelistStore;
  const commitSelectionStore = {} as unknown as CommitSelectionStore;

  const app = express();
  app.use(express.json());
  app.use('/api', createGitRoutes(manager, gitService, changelistStore, commitSelectionStore));
  app.use(errorHandler);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}/api`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('rejected gitService.getDiff returns 500 (not a hang)', async () => {
  const res = await fetch(`${base}/sessions/s1/diff`);
  assert.equal(res.status, 500);
  const body = await res.json() as { error?: string };
  assert.equal(body.error, 'Internal server error');
});

test('happy path GET git-branches is unchanged', async () => {
  const res = await fetch(`${base}/sessions/s1/git-branches`);
  assert.equal(res.status, 200);
  const body = await res.json() as { current: string };
  assert.equal(body.current, 'main');
});

// Typed error codes (plan 2026-10-29-003, Unit 2): fixable git failures carry
// `code`, and `error` is still there for clients that only read it.
async function serveGit(gitService: Partial<GitService>) {
  const manager = {
    getSessionInfo: (id: string) => ({ id, folderPath: '/tmp/repo', worktreePath: '/tmp/wt', worktreeBranch: 'feat' }),
  } as unknown as SessionManager;
  const app = express();
  app.use(express.json());
  app.use('/api', createGitRoutes(manager, gitService as GitService, {} as ChangelistStore, {} as CommitSelectionStore));
  app.use(errorHandler);
  const s = await new Promise<Server>((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
  const { port } = s.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/api`, close: () => new Promise<void>((r) => s.close(() => r())) };
}

const gitEnoent = () => Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT', syscall: 'spawn git', path: 'git' });

test('a git route whose git spawn fails with ENOENT answers 503 GIT_NOT_INSTALLED', async () => {
  const srv = await serveGit({ getParentRepoPath: async () => { throw gitEnoent(); } });
  try {
    const res = await fetch(`${srv.url}/sessions/s1/git-worktree-parent-info`);
    assert.equal(res.status, 503);
    const body = await res.json() as { error?: string; code?: string };
    assert.equal(body.code, 'GIT_NOT_INSTALLED');
    assert.ok(body.error);
  } finally {
    await srv.close();
  }
});

test('merge-worktree keeps success:false alongside the code', async () => {
  const srv = await serveGit({ getParentRepoPath: async () => { throw gitEnoent(); } });
  try {
    const res = await fetch(`${srv.url}/sessions/s1/git-merge-worktree`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 503);
    const body = await res.json() as { success?: boolean; code?: string };
    assert.equal(body.success, false);
    assert.equal(body.code, 'GIT_NOT_INSTALLED');
  } finally {
    await srv.close();
  }
});

test('GET diff maps the diff code to a status: not a repo 400, git missing 503', async () => {
  const empty = { unstaged: '', staged: '', branch: '', untracked: [], untrackedDiff: '' };
  let next: Record<string, unknown> = { ...empty, error: 'Not a git repository', code: 'NOT_A_GIT_REPO' };
  const srv = await serveGit({ getDiff: async () => next as never });
  try {
    let res = await fetch(`${srv.url}/sessions/s1/diff`);
    assert.equal(res.status, 400);
    assert.equal((await res.json() as { code?: string }).code, 'NOT_A_GIT_REPO');
    next = { ...empty, error: 'git is not installed', code: 'GIT_NOT_INSTALLED' };
    res = await fetch(`${srv.url}/sessions/s1/diff`);
    assert.equal(res.status, 503);
    const body = await res.json() as { code?: string; error?: string };
    assert.equal(body.code, 'GIT_NOT_INSTALLED');
    assert.equal(body.error, 'git is not installed');
  } finally {
    await srv.close();
  }
});
