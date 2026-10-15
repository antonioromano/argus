import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { SessionChain } from '@argus/shared';
import { createChainRoutes } from './chains.js';
import { ChainEngine, type ChainSessionView } from '../services/chains/ChainEngine.js';

// Beta F13 chain routes: gating, validation through the engine, CRUD, arm/disarm, audit.

async function serve(o: { enabled?: boolean } = {}) {
  let enabled = o.enabled ?? true;
  let saved: SessionChain[] = [];
  const sessions = new Map<string, ChainSessionView>([
    ['A', { status: 'running', agentType: 'claude' }],
    ['B', { status: 'idle', agentType: 'claude' }],
    ['SH', { status: 'idle', agentType: 'shell' }],
    ['X', { status: 'exited', agentType: 'claude' }],
  ]);
  const engine = new ChainEngine({
    isEnabled: () => enabled,
    store: { load: async () => [], save: async (l) => { saved = structuredClone(l); } },
    session: (id) => sessions.get(id),
    write: () => {},
    enterDelayMs: 60,
    setTimer: () => 0,
    clearTimer: () => {},
  });
  await engine.init(() => true);
  const app = express();
  app.use(express.json());
  app.use('/api/chains', createChainRoutes({ isEnabled: () => enabled, engine }));
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const { port } = server.address() as AddressInfo;
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/chains${url}`, {
      method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as Record<string, any> };
  };
  const close = () => new Promise<void>((r) => server.close(() => r()));
  return { call, close, engine, saved: () => saved, setEnabled: (v: boolean) => { enabled = v; } };
}

const VALID = { sourceId: 'A', targetId: 'B', trigger: 'idle', prompt: 'run the tests' };

test('every route 404s while the flag is off', async () => {
  const s = await serve({ enabled: false });
  try {
    assert.equal((await s.call('GET', '/')).status, 404);
    assert.equal((await s.call('GET', '/audit')).status, 404);
    assert.equal((await s.call('POST', '/', VALID)).status, 404);
    assert.equal((await s.call('PATCH', '/c1', { armed: true })).status, 404);
    assert.equal((await s.call('DELETE', '/c1')).status, 404);
    assert.equal(s.engine.list().length, 0);
  } finally { await s.close(); }
});

test('create validates on the server: A ≠ B, live sessions, agent target, prompt cap', async () => {
  const s = await serve();
  try {
    const bad = async (body: unknown) => { const r = await s.call('POST', '/', body); assert.equal(r.status, 400); return r.body.error as string; };
    assert.match(await bad({ ...VALID, targetId: 'A' }), /own session/);
    assert.match(await bad({ ...VALID, targetId: 'SH' }), /plain shell/);
    assert.match(await bad({ ...VALID, targetId: 'X' }), /exited/);
    assert.match(await bad({ ...VALID, sourceId: 'nope' }), /Unknown source/);
    assert.match(await bad({ ...VALID, prompt: 'x'.repeat(4001) }), /4000/);
    assert.match(await bad({ ...VALID, trigger: 'running' }), /trigger/);
    assert.match(await bad({ ...VALID, mode: 'x' }), /mode/);
    assert.match(await bad([1, 2]), /Invalid/);
    assert.equal(s.engine.list().length, 0);
  } finally { await s.close(); }
});

test('create, list, arm/disarm, delete', async () => {
  const s = await serve();
  try {
    const created = await s.call('POST', '/', VALID);
    assert.equal(created.status, 201);
    assert.equal(created.body.mode, 'once');
    assert.equal(created.body.armed, true);
    const id = created.body.id as string;

    const list = await s.call('GET', '/');
    assert.deepEqual(list.body.chains.map((c: SessionChain) => c.id), [id]);

    const off = await s.call('PATCH', `/${id}`, { armed: false });
    assert.equal(off.status, 200);
    assert.equal(off.body.armed, false);
    assert.equal((await s.call('PATCH', `/${id}`, { armed: 'yes' })).status, 400);
    assert.equal((await s.call('PATCH', '/missing', { armed: true })).status, 404);
    assert.equal((await s.call('PATCH', `/${encodeURIComponent('../x')}`, { armed: true })).status, 404);

    assert.equal((await s.call('DELETE', `/${id}`)).status, 204);
    assert.equal((await s.call('DELETE', `/${id}`)).status, 404);
    assert.deepEqual((await s.call('GET', '/')).body.chains, []);
    await s.engine.flush();
    assert.deepEqual(s.saved(), []);
  } finally { await s.close(); }
});

test('a repeat cycle is refused with a 400', async () => {
  const s = await serve();
  try {
    assert.equal((await s.call('POST', '/', { ...VALID, mode: 'repeat' })).status, 201);
    const back = await s.call('POST', '/', { ...VALID, sourceId: 'B', targetId: 'A', mode: 'repeat' });
    assert.equal(back.status, 400);
    assert.match(back.body.error, /loop/);
  } finally { await s.close(); }
});

test('GET /audit returns the fire log', async () => {
  const s = await serve();
  try {
    const r = await s.call('GET', '/audit');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { fires: [] });
  } finally { await s.close(); }
});
