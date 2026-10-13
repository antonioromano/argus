import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, realpathSync, mkdirSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { resolveSessionFolder } from './sessionFolder.js';
import { createSessionRoutes } from '../routes/sessions.js';
import type { SessionManager } from '../services/SessionManager.js';
import type { OrderStore } from '../persistence/OrderStore.js';
import type { GroupStore } from '../persistence/GroupStore.js';
import type { ConfigStore } from '../persistence/ConfigStore.js';

function tmp(): string {
  return realpathSync(mkdtempSync(path.join(os.tmpdir(), 'argus-folder-')));
}

// S7: a relative/`..`/symlinked folderPath was stored verbatim as the session's
// pathScope root — e.g. "." in the packaged app resolved to $HOME and widened
// every fs/git route to the whole home directory.
test('relative paths are rejected', async () => {
  for (const p of ['.', 'project', '../x', '~/code', '']) {
    await assert.rejects(resolveSessionFolder(p), /absolute/, JSON.stringify(p));
  }
  await assert.rejects(resolveSessionFolder(undefined), /absolute/);
});

test('the stored folder is the realpath (symlinks and .. resolved)', async () => {
  const root = tmp();
  try {
    mkdirSync(path.join(root, 'real'));
    symlinkSync(path.join(root, 'real'), path.join(root, 'link'));
    assert.equal(await resolveSessionFolder(path.join(root, 'link')), path.join(root, 'real'));
    assert.equal(await resolveSessionFolder(path.join(root, 'real', '..', 'real')), path.join(root, 'real'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('files and missing paths are rejected', async () => {
  const root = tmp();
  try {
    writeFileSync(path.join(root, 'f.txt'), 'x');
    await assert.rejects(resolveSessionFolder(path.join(root, 'f.txt')), /Not a directory/);
    await assert.rejects(resolveSessionFolder(path.join(root, 'missing')), /does not exist/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('POST /api/sessions rejects a relative folderPath before reaching the manager', async () => {
  const calls: string[] = [];
  const store = { load: async () => [], save: async () => {} } as unknown as OrderStore;
  const manager = { createSession: async (p: string) => { calls.push(p); throw new Error('unreachable'); } } as unknown as SessionManager;
  const app = express();
  app.use(express.json());
  app.use('/api/sessions', createSessionRoutes(manager, store, store, store as unknown as GroupStore, { load: async () => ({}) } as unknown as ConfigStore));
  const server = await new Promise<Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folderPath: '.' }),
    });
    assert.equal(res.status, 400);
    assert.deepEqual(calls, []);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
