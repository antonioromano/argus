import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { createWorktreeRoutes } from './worktrees.js';
import type { SessionManager } from '../services/SessionManager.js';
import type { GitService } from '../services/GitService.js';

const BASE = path.join(os.homedir(), '.argus', 'worktrees');
const WT = path.join(BASE, 'repo', 'feature');

interface Opts {
  git?: Partial<GitService>;
  sessions?: Array<{ name: string; folderPath: string; status: string }>;
}

async function serve({ git = {}, sessions = [] }: Opts = {}) {
  const app = express();
  app.use(express.json());
  const manager = { getAllSessions: () => sessions } as unknown as SessionManager;
  app.use('/api/worktrees', createWorktreeRoutes(manager, git as GitService));
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const { port } = server.address() as AddressInfo;
  const call = (method: string, route: string, body?: unknown) => fetch(`http://127.0.0.1:${port}/api/worktrees${route}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { call, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const q = (o: Record<string, string>) => '/check?' + new URLSearchParams(o).toString();

test('GET /check requires an absolute repoPath', async () => {
  const srv = await serve();
  try {
    assert.equal((await srv.call('GET', q({ repoPath: 'relative/path' }))).status, 400);
    assert.equal((await srv.call('GET', '/check')).status, 400);
  } finally { await srv.close(); }
});

test('GET /check reports a non-repo', async () => {
  const srv = await serve({ git: { isGitRepo: async () => false } });
  try {
    const res = await srv.call('GET', q({ repoPath: '/some/dir' }));
    assert.deepEqual(await res.json(), { isGitRepo: false });
  } finally { await srv.close(); }
});

test('GET /check rejects a worktreePath outside the managed base', async () => {
  const srv = await serve({ git: { isGitRepo: async () => true } });
  try {
    const res = await srv.call('GET', q({ repoPath: '/r', worktreePath: '/etc' }));
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /managed worktrees directory/);
  } finally { await srv.close(); }
});

test('GET /check rejects option-like and traversal branch names', async () => {
  const srv = await serve({ git: { isGitRepo: async () => true } });
  try {
    assert.equal((await srv.call('GET', q({ repoPath: '/r', branch: '--delete' }))).status, 400);
    assert.equal((await srv.call('GET', q({ repoPath: '/r', branch: 'a/../b' }))).status, 400);
  } finally { await srv.close(); }
});

test('GET /check reports dirty/unmerged state for a managed worktree', async () => {
  let dirtyArg: string | undefined;
  const srv = await serve({
    git: {
      isGitRepo: async () => true,
      getGitRoot: async () => '/r',
      worktreeDirtyCheck: async (p: string) => { dirtyArg = p; return true; },
      worktreeUnmergedCheck: async () => false,
    },
  });
  try {
    const res = await srv.call('GET', q({ repoPath: '/r', worktreePath: WT, worktreeBranch: 'feature' }));
    assert.deepEqual(await res.json(), { isGitRepo: true, isDirty: true, isUnmerged: false });
    assert.equal(dirtyArg, WT);
  } finally { await srv.close(); }
});

test('GET /check degrades to clean when the git checks throw', async () => {
  const srv = await serve({
    git: {
      isGitRepo: async () => true,
      getGitRoot: async () => { throw new Error('nope'); },
    },
  });
  try {
    const res = await srv.call('GET', q({ repoPath: '/r', worktreePath: WT }));
    assert.deepEqual(await res.json(), { isGitRepo: true, isDirty: false, isUnmerged: false });
  } finally { await srv.close(); }
});

test('GET /branches validates the path and handles non-repos and git errors', async () => {
  let repo = true;
  let boom = false;
  const srv = await serve({
    git: {
      isGitRepo: async () => repo,
      getGitRoot: async () => '/r',
      getBranches: async () => { if (boom) throw new Error('git broke'); return { branches: ['main'], currentBranch: 'main' } as never; },
    },
  });
  try {
    assert.equal((await srv.call('GET', '/branches?repoPath=rel')).status, 400);
    assert.deepEqual(await (await srv.call('GET', '/branches?repoPath=/r')).json(), { branches: ['main'], currentBranch: 'main' });
    repo = false;
    assert.deepEqual(await (await srv.call('GET', '/branches?repoPath=/r')).json(), { branches: [], currentBranch: '' });
    repo = true; boom = true;
    const res = await srv.call('GET', '/branches?repoPath=/r');
    assert.equal(res.status, 500);
    assert.equal(((await res.json()) as { error: string }).error, 'git broke');
  } finally { await srv.close(); }
});

test('DELETE requires both paths', async () => {
  const srv = await serve();
  try {
    assert.equal((await srv.call('DELETE', '/', { worktreePath: WT })).status, 400);
    assert.equal((await srv.call('DELETE', '/', { repoPath: '/r' })).status, 400);
  } finally { await srv.close(); }
});

test('DELETE refuses paths outside the managed base, including prefix lookalikes', async () => {
  let removed = false;
  const srv = await serve({ git: { getGitRoot: async () => '/r', worktreeRemove: async () => { removed = true; } } });
  try {
    for (const p of ['/etc/passwd', BASE, BASE + '-evil/x', path.join(BASE, '..', 'x')]) {
      const res = await srv.call('DELETE', '/', { worktreePath: p, repoPath: '/r' });
      assert.equal(res.status, 400, p);
    }
    assert.equal(removed, false);
  } finally { await srv.close(); }
});

test('DELETE returns 409 while a live session uses the worktree, but not for an exited one', async () => {
  let removed = 0;
  const git = { getGitRoot: async () => '/r', worktreeRemove: async () => { removed++; } };
  const live = await serve({ git, sessions: [{ name: 'busy', folderPath: WT, status: 'running' }] });
  try {
    const res = await live.call('DELETE', '/', { worktreePath: WT, repoPath: '/r' });
    assert.equal(res.status, 409);
    assert.match(((await res.json()) as { error: string }).error, /busy/);
    assert.equal(removed, 0);
  } finally { await live.close(); }

  const exited = await serve({ git, sessions: [{ name: 'done', folderPath: WT, status: 'exited' }] });
  try {
    assert.equal((await exited.call('DELETE', '/', { worktreePath: WT, repoPath: '/r' })).status, 204);
    assert.equal(removed, 1);
  } finally { await exited.close(); }
});

test('DELETE passes force through and surfaces git stderr as a 400', async () => {
  let forceArg: boolean | undefined;
  let fail = false;
  const srv = await serve({
    git: {
      getGitRoot: async () => '/r',
      worktreeRemove: async (_r: string, _p: string, force?: boolean) => {
        forceArg = force;
        if (fail) throw Object.assign(new Error('x'), { stderr: 'contains modified files' });
      },
    },
  });
  try {
    assert.equal((await srv.call('DELETE', '/', { worktreePath: WT, repoPath: '/r', force: true })).status, 204);
    assert.equal(forceArg, true);
    fail = true;
    const res = await srv.call('DELETE', '/', { worktreePath: WT, repoPath: '/r' });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { error: string }).error, 'contains modified files');
  } finally { await srv.close(); }
});

test('POST /init validates folderPath and confines it to the home directory', async () => {
  const inited: string[] = [];
  const srv = await serve({ git: { init: async (p: string) => { inited.push(p); } } });
  try {
    assert.equal((await srv.call('POST', '/init', {})).status, 400);
    assert.equal((await srv.call('POST', '/init', { folderPath: '/tmp/outside-home' })).status, 400);
    assert.equal((await srv.call('POST', '/init', { folderPath: os.homedir() + '-other' })).status, 400);
    const ok = await srv.call('POST', '/init', { folderPath: path.join(os.homedir(), 'proj') });
    assert.deepEqual(await ok.json(), { success: true });
    assert.deepEqual(inited, [path.join(os.homedir(), 'proj')]);
  } finally { await srv.close(); }
});

test('POST /init returns 500 with the git error', async () => {
  const srv = await serve({ git: { init: async () => { throw new Error('init failed'); } } });
  try {
    const res = await srv.call('POST', '/init', { folderPath: path.join(os.homedir(), 'p') });
    assert.equal(res.status, 500);
    assert.equal(((await res.json()) as { error: string }).error, 'init failed');
  } finally { await srv.close(); }
});
