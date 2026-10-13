import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, realpathSync, rmSync } from 'fs';
import { createFilesystemRoutes } from './filesystem.js';

// realpath: macOS tmp lives under /private, and pathScope re-checks via realpath.
const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'argus-fsroot-')));
const fakeManager = {
  getSession: (id: string) => (id === 's1' ? { id: 's1', folderPath: root } : undefined),
} as any;

let server: Server;
let base: string;

before(async () => {
  mkdirSync(path.join(root, '.git'));
  writeFileSync(path.join(root, 'a.txt'), 'a');
  const app = express();
  app.use('/api/fs', createFilesystemRoutes(fakeManager, {}));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/fs`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

const send = (method: string, route: string, body: unknown) =>
  fetch(base + route, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('DELETE of the session root is refused and the project survives', async () => {
  for (const p of [root, root + '/', path.join(root, 'sub', '..')]) {
    const res = await send('DELETE', '/file', { sessionId: 's1', path: p });
    assert.equal(res.status, 403, `delete ${p}`);
  }
  assert.ok(existsSync(path.join(root, '.git')), '.git still there');
});

test('rename and move cannot carry the session root away', async () => {
  const to = path.join(root, 'moved');
  assert.equal((await send('POST', '/rename', { sessionId: 's1', fromPath: root, toPath: to })).status, 403);
  assert.equal((await send('POST', '/move', { sessionId: 's1', fromPath: root, toPath: to })).status, 403);
  assert.ok(existsSync(path.join(root, 'a.txt')));
});

test('files inside the root can still be deleted', async () => {
  const res = await send('DELETE', '/file', { sessionId: 's1', path: path.join(root, 'a.txt') });
  assert.equal(res.status, 200);
  assert.equal(existsSync(path.join(root, 'a.txt')), false);
});
