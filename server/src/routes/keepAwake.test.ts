import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { createKeepAwakeRoutes, KEEP_AWAKE_BAD_DURATION } from './keepAwake.js';
import { KeepAwakeService } from '../services/KeepAwakeService.js';
import { SleepPreventionService } from '../services/SleepPreventionService.js';
import type { SleepBlocker } from '../services/SleepPreventionService.js';

// Integration test for /api/keep-awake: a real express app over a real service,
// with only the OS blocker and the expiry timer faked (a real caffeinate would
// outlive the run; a real timer would make expiry untestable).

class FakeBlocker implements SleepBlocker {
  private _active = false;
  async start(): Promise<void> { this._active = true; }
  async stop(): Promise<void> { this._active = false; }
  get active(): boolean { return this._active; }
}

const NOW = 1_000_000;

let svc: KeepAwakeService;
let server: Server;
let base: string;

before(async () => {
  svc = new KeepAwakeService(
    new SleepPreventionService(new FakeBlocker()),
    () => NOW,
    // Expiry is exercised in KeepAwakeService.test.ts; here the timer just must
    // not fire during the HTTP round-trips.
    () => () => {},
  );
  const app = express();
  app.use(express.json());
  app.use('/keep-awake', createKeepAwakeRoutes(svc));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}/keep-awake`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// Tests share one service (the route holds a reference), so each starts from off.
beforeEach(async () => {
  await svc.disarm();
});

async function post(body: unknown) {
  const res = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test('GET returns the current status', async () => {
  const res = await fetch(base);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { active: false, expiresAt: null, indefinite: false });
});

test('POST with an allowlisted duration arms and echoes the status', async () => {
  const { status, body } = await post({ durationMs: 30 * 60_000 });
  assert.equal(status, 200);
  assert.deepEqual(body, { active: true, expiresAt: NOW + 30 * 60_000, indefinite: false });
  assert.equal(svc.status.active, true);
});

test('POST with null arms indefinitely', async () => {
  const { body } = await post({ durationMs: null });
  assert.deepEqual(body, { active: true, expiresAt: null, indefinite: true });
});

test('every allowlisted window is accepted', async () => {
  for (const minutes of [5, 15, 30, 60, 120, 240]) {
    const { status, body } = await post({ durationMs: minutes * 60_000 });
    assert.equal(status, 200, `${minutes}m should be accepted`);
    assert.equal(body.expiresAt, NOW + minutes * 60_000);
  }
});

test('POST rejects a duration outside the allowlist and does not arm', async () => {
  for (const bad of [7 * 60_000, -1, 0, '30m', true, 8 * 60 * 60_000]) {
    const { status, body } = await post({ durationMs: bad });
    assert.equal(status, 400, `${String(bad)} should be rejected`);
    assert.deepEqual(body, { error: KEEP_AWAKE_BAD_DURATION });
  }
  assert.equal(svc.status.active, false, 'no rejected request may arm the blocker');
});

test('POST with an empty body is a 400, not a crash', async () => {
  const { status } = await post({});
  assert.equal(status, 400);
});

test('DELETE disarms', async () => {
  await post({ durationMs: 60 * 60_000 });
  const res = await fetch(base, { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { active: false, expiresAt: null, indefinite: false });
  assert.equal(svc.status.active, false);
});

test('DELETE while already off is a no-op, not an error', async () => {
  const res = await fetch(base, { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).active, false);
});
