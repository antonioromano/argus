import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, rmSync } from 'fs';
import { createFilesystemRoutes } from './filesystem.js';
import { StagedTrash } from '../services/StagedTrash.js';

// Explorer delete through the staged trash (plan 004 U7): undoable by default,
// restore scoped to the session; EXDEV falls back to an explicit permanent delete.

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'argus-fstrash-')));
const root = path.join(tmp, 'project');
const other = path.join(tmp, 'other');
const fakeManager = {
  getSession: (id: string) => (id === 's1' ? { id: 's1', folderPath: root } : id === 's2' ? { id: 's2', folderPath: other } : undefined),
} as any;
let exdev = false;
const trash = new StagedTrash(path.join(tmp, 'data', 'trash'), {
  rename: async (from, to) => {
    if (exdev) throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' });
    const { rename } = await import('fs/promises');
    await rename(from, to);
  },
});

let server: Server;
let base: string;
before(async () => {
  mkdirSync(root, { recursive: true });
  mkdirSync(other, { recursive: true });
  const app = express();
  app.use('/api/fs', createFilesystemRoutes(fakeManager, { trash }));
  server = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/fs`;
});
after(async () => {
  await trash.purgeAll();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(tmp, { recursive: true, force: true });
});

const send = async (method: string, route: string, body: unknown) => {
  const res = await fetch(base + route, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() as { success: boolean; undoId?: string; error?: string; needsPermanent?: boolean } };
};

test('DELETE stages into the trash and restore brings the file back', async () => {
  const file = path.join(root, 'a.txt');
  writeFileSync(file, 'hello');
  const del = await send('DELETE', '/file', { sessionId: 's1', path: file });
  assert.equal(del.status, 200);
  assert.ok(del.body.undoId);
  assert.equal(existsSync(file), false);
  const res = await send('POST', '/file/restore', { sessionId: 's1', undoId: del.body.undoId });
  assert.equal(res.status, 200);
  assert.equal(readFileSync(file, 'utf8'), 'hello');
});

test('restore through another session is refused', async () => {
  const file = path.join(root, 'b.txt');
  writeFileSync(file, 'b');
  const del = await send('DELETE', '/file', { sessionId: 's1', path: file });
  const res = await send('POST', '/file/restore', { sessionId: 's2', undoId: del.body.undoId });
  assert.equal(res.status, 403);
  assert.equal(existsSync(file), false);
  assert.equal(existsSync(path.join(other, 'b.txt')), false);
});

test('restore of an unknown id or for a missing session answers 404; a malformed body 400', async () => {
  assert.equal((await send('POST', '/file/restore', { sessionId: 's1', undoId: 'nope' })).status, 404);
  assert.equal((await send('POST', '/file/restore', { sessionId: 'ghost', undoId: 'nope' })).status, 404);
  assert.equal((await send('POST', '/file/restore', { sessionId: 's1' })).status, 400);
});

test('EXDEV answers 409 needsPermanent; permanent: true then deletes for good', async () => {
  const file = path.join(root, 'c.txt');
  writeFileSync(file, 'c');
  exdev = true;
  try {
    const del = await send('DELETE', '/file', { sessionId: 's1', path: file });
    assert.equal(del.status, 409);
    assert.equal(del.body.needsPermanent, true);
    assert.equal(existsSync(file), true);
    const perm = await send('DELETE', '/file', { sessionId: 's1', path: file, permanent: true });
    assert.equal(perm.status, 200);
    assert.equal(perm.body.undoId, undefined);
    assert.equal(existsSync(file), false);
  } finally { exdev = false; }
});

test('the session root still cannot be deleted (or staged)', async () => {
  const del = await send('DELETE', '/file', { sessionId: 's1', path: root });
  assert.equal(del.status, 403);
  assert.ok(existsSync(root));
});
