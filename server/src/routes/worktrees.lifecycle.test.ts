import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { SessionInfo, SessionPr, WorktreeFinishInfo, WorktreeFinishResponse } from '@argus/shared';
import { createWorktreeRoutes, type WorktreeLifecycleDeps } from './worktrees.js';
import type { SessionManager } from '../services/SessionManager.js';
import type { GitService } from '../services/GitService.js';

// Beta F8 lifecycle routes: gating, input validation, step order + stop on
// failure, and the removal guards. Git and gh are fakes; nothing touches disk.

const BASE = path.join(os.homedir(), '.argus', 'worktrees');
const WT = path.join(BASE, 'repo', 'feat', 'x');
const PARENT = '/repos/repo';

const SESSION: SessionInfo = {
  id: 's1', name: 'x', folderPath: WT, status: 'idle', createdAt: '2026-10-01T00:00:00Z',
  agentType: 'claude', flags: [], worktreePath: WT, worktreeBranch: 'feat/x',
};

interface Opts {
  enabled?: boolean;
  session?: Partial<SessionInfo> | null;
  others?: SessionInfo[];
  git?: Partial<GitService>;
  pr?: SessionPr | null;
  gh?: boolean;
  createPr?: () => Promise<string>;
}

async function serve(o: Opts = {}) {
  const calls: string[] = [];
  const session = o.session === null ? undefined : { ...SESSION, ...o.session };
  const manager = {
    getSessionInfo: (id: string) => (session && id === session.id ? session : undefined),
    getAllSessions: () => [...(session ? [session] : []), ...(o.others ?? [])],
    resolveWithinAnySession: (p: string) => (session && path.resolve(p).startsWith(path.resolve(session.folderPath)) ? path.resolve(p) : null),
    destroySession: async (id: string) => { calls.push(`destroy:${id}`); },
  } as unknown as SessionManager;
  const git: Partial<GitService> = {
    headInfo: async () => ({ root: WT, branch: session?.worktreeBranch ?? '' }),
    getParentRepoPath: async () => PARENT,
    getDefaultBranch: async () => 'main',
    upstreamOf: async () => 'origin/feat/x',
    worktreeDirtyCheck: async () => false,
    remoteUrl: async () => 'git@github.com:acme/app.git',
    worktreeUnmergedCheck: async () => true,
    commitAll: async (_f: string, m: string) => { calls.push(`commit:${m}`); return { success: true, commitHash: 'abc1234' }; },
    pushBranch: async (_f: string, b: string, up: boolean) => { calls.push(`push:${b}:${up}`); return { success: true }; },
    worktreeRemove: async (root: string, p: string, force?: boolean) => { calls.push(`remove:${root}:${p}:${force}`); },
    ...o.git,
  };
  const lifecycle: WorktreeLifecycleDeps = {
    isEnabled: () => o.enabled ?? true,
    prService: {
      forFolder: async () => o.pr ?? null,
      ghAvailable: async () => o.gh ?? true,
      createPr: o.createPr ?? (async () => { calls.push('gh:create'); return 'https://github.com/acme/app/pull/5'; }),
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/worktrees', createWorktreeRoutes(manager, git as GitService, lifecycle));
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const { port } = server.address() as AddressInfo;
  const call = async (method: string, route: string, body?: unknown) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/worktrees${route}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  return { call, calls, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const PR_MERGED: SessionPr = { number: 5, state: 'merged', url: 'https://github.com/acme/app/pull/5', ci: 'none', branch: 'feat/x' };

// ── gating + validation ───────────────────────────────────────────────────

test('every lifecycle route is a 404 while the beta flag is off', async () => {
  const srv = await serve({ enabled: false });
  try {
    assert.equal((await srv.call('GET', '/sessions/s1/finish')).status, 404);
    assert.equal((await srv.call('POST', '/sessions/s1/finish', { steps: ['push'] })).status, 404);
    assert.equal((await srv.call('POST', '/sessions/s1/remove')).status, 404);
    assert.deepEqual(srv.calls, []);
  } finally { await srv.close(); }
});

test('unknown and non-worktree sessions are rejected', async () => {
  let srv = await serve({ session: null });
  try { assert.equal((await srv.call('GET', '/sessions/s1/finish')).status, 404); } finally { await srv.close(); }
  srv = await serve({ session: { worktreePath: undefined, worktreeBranch: undefined } });
  try { assert.equal((await srv.call('GET', '/sessions/s1/finish')).status, 400); } finally { await srv.close(); }
});

test('a worktree outside the managed base is rejected', async () => {
  const srv = await serve({ session: { folderPath: '/etc/x', worktreePath: '/etc/x' } });
  try {
    const res = await srv.call('GET', '/sessions/s1/finish');
    assert.equal(res.status, 400);
    assert.match(String(res.body.error), /managed worktrees/);
  } finally { await srv.close(); }
});

test('an option-like or range branch name is rejected before git runs', async () => {
  for (const bad of ['--force', 'main..evil']) {
    const srv = await serve({ session: { worktreeBranch: bad } });
    try {
      const res = await srv.call('POST', '/sessions/s1/finish', { steps: ['push'] });
      assert.equal(res.status, 400, bad);
      assert.deepEqual(srv.calls, []);
    } finally { await srv.close(); }
  }
});

test('a worktree whose checked-out branch changed is refused', async () => {
  const srv = await serve({ git: { headInfo: async () => ({ root: WT, branch: 'other' }) } });
  try { assert.equal((await srv.call('POST', '/sessions/s1/finish', { steps: ['push'] })).status, 409); } finally { await srv.close(); }
});

test('finish validates the step list and the commit message', async () => {
  const srv = await serve();
  try {
    assert.equal((await srv.call('POST', '/sessions/s1/finish', {})).status, 400);
    assert.equal((await srv.call('POST', '/sessions/s1/finish', { steps: [] })).status, 400);
    assert.equal((await srv.call('POST', '/sessions/s1/finish', { steps: ['merge'] })).status, 400);
    assert.equal((await srv.call('POST', '/sessions/s1/finish', { steps: ['commit'] })).status, 400);
    assert.equal((await srv.call('POST', '/sessions/s1/finish', { steps: ['commit'], message: '  ' })).status, 400);
    assert.deepEqual(srv.calls, []);
  } finally { await srv.close(); }
});

// ── finish ────────────────────────────────────────────────────────────────

test('finish info reports branch, upstream, compare URL and why removal is blocked', async () => {
  const srv = await serve({ git: { worktreeDirtyCheck: async () => true } });
  try {
    const { status, body } = await srv.call('GET', '/sessions/s1/finish');
    assert.equal(status, 200);
    const info = body as unknown as WorktreeFinishInfo;
    assert.equal(info.branch, 'feat/x');
    assert.equal(info.upstream, 'origin/feat/x');
    assert.equal(info.dirty, true);
    assert.equal(info.compareUrl, 'https://github.com/acme/app/compare/main...feat/x?expand=1');
    assert.equal(info.merged, false);
    assert.equal(info.removable, false);
    assert.match(String(info.removeBlockedReason), /uncommitted/);
  } finally { await srv.close(); }
});

test('finish runs commit → push → pr in order and returns the PR url', async () => {
  const srv = await serve({ git: { worktreeDirtyCheck: async () => true, upstreamOf: async () => null } });
  try {
    const { status, body } = await srv.call('POST', '/sessions/s1/finish', { steps: ['pr', 'push', 'commit'], message: 'feat: x' });
    assert.equal(status, 200);
    const r = body as unknown as WorktreeFinishResponse;
    assert.equal(r.ok, true);
    assert.deepEqual(r.results.map((s) => s.step), ['commit', 'push', 'pr']);
    assert.equal(r.results[2].url, 'https://github.com/acme/app/pull/5');
    // No upstream yet → the push publishes and tracks the branch.
    assert.deepEqual(srv.calls, ['commit:feat: x', 'push:feat/x:true', 'gh:create']);
  } finally { await srv.close(); }
});

test('finish stops at the first failure and never opens the PR', async () => {
  const srv = await serve({ git: { pushBranch: async () => ({ success: false, error: 'rejected' }) } });
  try {
    const r = (await srv.call('POST', '/sessions/s1/finish', { steps: ['push', 'pr'] })).body as unknown as WorktreeFinishResponse;
    assert.equal(r.ok, false);
    assert.deepEqual(r.results, [
      { step: 'push', status: 'failed', detail: 'rejected' },
      { step: 'pr', status: 'skipped' },
    ]);
    assert.ok(!srv.calls.includes('gh:create'));
  } finally { await srv.close(); }
});

test('without gh the pr step hands back the compare URL', async () => {
  const srv = await serve({ gh: false });
  try {
    const r = (await srv.call('POST', '/sessions/s1/finish', { steps: ['pr'] })).body as unknown as WorktreeFinishResponse;
    assert.equal(r.ok, true);
    assert.equal(r.results[0].url, 'https://github.com/acme/app/compare/main...feat/x?expand=1');
    assert.ok(!srv.calls.includes('gh:create'));
  } finally { await srv.close(); }
});

test('a gh pr create error fails the pr step with its message', async () => {
  const srv = await serve({ createPr: async () => { throw Object.assign(new Error('exit 1'), { stderr: 'no commits between main and feat/x' }); } });
  try {
    const r = (await srv.call('POST', '/sessions/s1/finish', { steps: ['pr'] })).body as unknown as WorktreeFinishResponse;
    assert.deepEqual(r.results, [{ step: 'pr', status: 'failed', detail: 'no commits between main and feat/x' }]);
  } finally { await srv.close(); }
});

// ── remove ────────────────────────────────────────────────────────────────

test('remove refuses a dirty worktree and leaves the session running', async () => {
  const srv = await serve({ pr: PR_MERGED, git: { worktreeDirtyCheck: async () => true } });
  try {
    const res = await srv.call('POST', '/sessions/s1/remove');
    assert.equal(res.status, 409);
    assert.match(String(res.body.error), /uncommitted changes/);
    assert.deepEqual(srv.calls, []);
  } finally { await srv.close(); }
});

test('remove refuses an unmerged branch', async () => {
  const srv = await serve({ pr: { ...PR_MERGED, state: 'open' } });
  try {
    const res = await srv.call('POST', '/sessions/s1/remove');
    assert.equal(res.status, 409);
    assert.match(String(res.body.error), /not merged/);
    assert.deepEqual(srv.calls, []);
  } finally { await srv.close(); }
});

test('remove refuses while another live session uses the worktree', async () => {
  const srv = await serve({ pr: PR_MERGED, others: [{ ...SESSION, id: 's2', name: 'twin' }] });
  try {
    assert.equal((await srv.call('POST', '/sessions/s1/remove')).status, 409);
    assert.deepEqual(srv.calls, []);
  } finally { await srv.close(); }
});

test('remove of a merged PR ends the session first, then removes the worktree without --force', async () => {
  const srv = await serve({ pr: PR_MERGED });
  try {
    const res = await srv.call('POST', '/sessions/s1/remove');
    assert.equal(res.status, 200);
    assert.deepEqual(srv.calls, ['destroy:s1', `remove:${PARENT}:${WT}:false`]);
  } finally { await srv.close(); }
});

test('remove of a branch fully merged into the default branch is allowed without a PR', async () => {
  const srv = await serve({ git: { worktreeUnmergedCheck: async (_r: string, _b: string, target?: string) => target !== 'main' } });
  try {
    assert.equal((await srv.call('POST', '/sessions/s1/remove')).status, 200);
    assert.deepEqual(srv.calls, ['destroy:s1', `remove:${PARENT}:${WT}:false`]);
  } finally { await srv.close(); }
});
