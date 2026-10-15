import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'net';
import type { ActivityEvent } from '@argus/shared';
import { createActivityRoutes } from './activity.js';

async function withServer(enabled: boolean, fn: (base: string) => Promise<void>): Promise<void> {
  const events: ActivityEvent[] = [{ id: 1, at: 5, type: 'tool', tool: 'Bash', summary: 'ls' }];
  const app = express();
  app.use('/api/sessions', createActivityRoutes({
    isEnabled: () => enabled,
    getActivity: (id) => (id === 's1' ? events : undefined),
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/sessions`);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('404 while betaActivityTimeline is off', async () => {
  await withServer(false, async (base) => {
    const res = await fetch(`${base}/s1/activity`);
    assert.equal(res.status, 404);
  });
});

test('returns the session ring when on; 404 for an unknown session', async () => {
  await withServer(true, async (base) => {
    const res = await fetch(`${base}/s1/activity`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { events: [{ id: 1, at: 5, type: 'tool', tool: 'Bash', summary: 'ls' }] });
    assert.equal((await fetch(`${base}/nope/activity`)).status, 404);
  });
});
