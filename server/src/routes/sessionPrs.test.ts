import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { SessionPrDiffResponse, SessionPrsResponse } from '@argus/shared';
import { createSessionPrRoutes } from './sessionPrs.js';

const LIST: SessionPrsResponse = {
  enabled: true,
  prs: [{ url: 'https://github.com/o/r/pull/1', pr: null, folderBranch: false, linked: true }],
};

let server: Server;
let base: string;
const asked: string[] = [];
const diffAsked: Array<[string, string]> = [];
const DIFF: SessionPrDiffResponse = { url: 'https://github.com/o/r/pull/1', diff: 'diff --git a/x b/x\n' };

before(async () => {
  const app = express();
  app.use('/api', createSessionPrRoutes({
    listSessionPrs: async (id: string) => { asked.push(id); return id === 's1' ? LIST : null; },
    sessionPrDiff: async (id: string, url: string) => {
      diffAsked.push([id, url]);
      return id === 's1' && url === DIFF.url
        ? { ok: true as const, diff: DIFF }
        : { ok: false as const, status: 404 as const, error: 'Not a pull request of this session' };
    },
  }));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

test('GET /sessions/:id/prs answers the session list, uncached', async () => {
  const res = await fetch(`${base}/api/sessions/s1/prs`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  assert.deepEqual(await res.json(), LIST);
});

test('GET /sessions/:id/prs is 404 for an unknown session', async () => {
  const res = await fetch(`${base}/api/sessions/missing/prs`);
  assert.equal(res.status, 404);
  assert.deepEqual(asked, ['s1', 'missing']);
});

const diffUrl = (id: string, url: string) => `${base}/api/sessions/${id}/pr-diff?url=${encodeURIComponent(url)}`;

test('GET /sessions/:id/pr-diff answers the diff of a session PR, uncached', async () => {
  const res = await fetch(diffUrl('s1', DIFF.url));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  assert.deepEqual(await res.json(), DIFF);
});

test('GET /sessions/:id/pr-diff passes the manager\'s refusal through', async () => {
  const res = await fetch(diffUrl('s1', 'https://github.com/o/r/pull/2'));
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'Not a pull request of this session' });
});

test('GET /sessions/:id/pr-diff rejects a non-PR url before asking the manager', async () => {
  diffAsked.length = 0;
  for (const bad of ['', 'https://evil.example/o/r/pull/1', 'https://github.com/o/r/pull/1 --repo x', 'https://github.com/o/r/issues/1']) {
    const res = await fetch(diffUrl('s1', bad));
    assert.equal(res.status, 400, bad);
  }
  assert.equal((await fetch(`${base}/api/sessions/s1/pr-diff`)).status, 400);
  assert.deepEqual(diffAsked, []);
});
