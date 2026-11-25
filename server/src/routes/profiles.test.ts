import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'net';
import type { ProfilesState } from '@argus/shared';
import { createProfileRoutes } from './profiles.js';

function setup(initial: ProfilesState = { activeId: null, profiles: [], prompt: 'pending' }) {
  let stored = structuredClone(initial);
  let changed = 0;
  const app = express();
  app.use(express.json());
  app.use('/api/profiles', createProfileRoutes({
    store: { load: async () => structuredClone(stored), save: async (s) => { stored = structuredClone(s); } },
    suggestedName: async () => 'Ada Lovelace',
    onChanged: () => { changed++; },
  }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/profiles`;
  const call = async (method: string, body?: unknown) => {
    const res = await fetch(base, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  return { call, stored: () => stored, changed: () => changed, close: () => server.close() };
}

const profile = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: `P ${id}`, avatar: '', createdAt: 1, settings: {}, ...extra });

test('GET returns the empty state plus a suggested name', async (t) => {
  const s = setup(); t.after(s.close);
  const r = await s.call('GET');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { activeId: null, profiles: [], prompt: 'pending', suggestedName: 'Ada Lovelace' });
});

test('PUT stores a valid state and announces the change', async (t) => {
  const s = setup(); t.after(s.close);
  const next = { activeId: 'a', profiles: [profile('a', { settings: { density: 'compact', themeMode: 'dark', colorTheme: 'github' } })], prompt: 'done' };
  const r = await s.call('PUT', next);
  assert.equal(r.status, 200);
  assert.deepEqual(s.stored(), next);
  assert.equal(s.changed(), 1);
});

test('PUT drops unknown setting keys and non-primitive values', async (t) => {
  const s = setup(); t.after(s.close);
  await s.call('PUT', { activeId: 'a', profiles: [profile('a', { settings: { density: 'compact', customAgents: [{ x: 1 }], ptyBackend: 'tmux', showTips: { evil: true } } })], prompt: 'done' });
  assert.deepEqual(s.stored().profiles[0].settings, { density: 'compact' });
});

test('PUT repairs the state: bad ids, duplicates, blank names, unknown activeId, bad prompt', async (t) => {
  const s = setup(); t.after(s.close);
  await s.call('PUT', {
    activeId: 'missing',
    profiles: [profile('a'), profile('a'), profile('../x'), profile('b', { name: '   ' }), profile('c', { name: '  Work  ' })],
    prompt: 'whatever',
  });
  const st = s.stored();
  assert.deepEqual(st.profiles.map((p) => p.id), ['a', 'c']);
  assert.equal(st.profiles[1].name, 'Work');
  assert.equal(st.activeId, 'a');
  assert.equal(st.prompt, 'pending');
});

test('PUT rejects a body that is not a state', async (t) => {
  const s = setup(); t.after(s.close);
  const r = await s.call('PUT', [1, 2]);
  assert.equal(r.status, 400);
  assert.equal(s.changed(), 0);
});
