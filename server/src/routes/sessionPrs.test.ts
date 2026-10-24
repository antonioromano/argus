import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { SessionPrsResponse } from '@argus/shared';
import { createSessionPrRoutes } from './sessionPrs.js';

const LIST: SessionPrsResponse = {
  enabled: true,
  prs: [{ url: 'https://github.com/o/r/pull/1', pr: null, folderBranch: false, linked: true }],
};

let server: Server;
let base: string;
const asked: string[] = [];

before(async () => {
  const app = express();
  app.use('/api', createSessionPrRoutes({
    listSessionPrs: async (id: string) => { asked.push(id); return id === 's1' ? LIST : null; },
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
