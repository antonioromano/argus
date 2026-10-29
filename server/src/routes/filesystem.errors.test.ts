import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, realpath, chmod } from 'fs/promises';
import { tmpdir } from 'os';
import path, { join } from 'path';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { SessionManager } from '../services/SessionManager.js';
import { createFilesystemRoutes } from './filesystem.js';

// Typed error codes on the fs routes (plan 2026-10-29-003, Unit 2): a fixable
// failure carries `code`, and `error` is kept for clients that only read it.

let dir: string;
let server: Server;
let base: string;

before(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'argus-fs-errors-')));
  await writeFile(join(dir, 'locked.txt'), 'secret\n');
  await chmod(join(dir, 'locked.txt'), 0o000);
  const fakeSm = {
    resolveWithinAnySession(rawPath: string): string | null {
      const resolved = path.resolve(rawPath);
      return resolved === dir || resolved.startsWith(dir + path.sep) ? resolved : null;
    },
  } as unknown as SessionManager;
  const app = express();
  // ripgrep stubbed away: a packaging fault, not a search error.
  app.use('/fs', createFilesystemRoutes(fakeSm, { ripgrepPath: () => null }));
  server = await new Promise<Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/fs`;
});

after(async () => {
  await chmod(join(dir, 'locked.txt'), 0o644);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
});

test('Find in Files without ripgrep answers 503 RIPGREP_UNAVAILABLE', async () => {
  const res = await fetch(`${base}/find?path=${encodeURIComponent(dir)}&q=needle`);
  assert.equal(res.status, 503);
  const body = await res.json() as { error?: string; code?: string };
  assert.equal(body.code, 'RIPGREP_UNAVAILABLE');
  assert.ok(body.error);
});

test('reading a missing file is a 404 FOLDER_NOT_FOUND', async () => {
  const res = await fetch(`${base}/file?path=${encodeURIComponent(join(dir, 'nope.txt'))}`);
  assert.equal(res.status, 404);
  const body = await res.json() as { error?: string; code?: string };
  assert.equal(body.code, 'FOLDER_NOT_FOUND');
  assert.equal(body.error, 'file not found');
});

test('reading an unreadable file is a 403 PERMISSION_DENIED', { skip: process.getuid?.() === 0 }, async () => {
  const res = await fetch(`${base}/file?path=${encodeURIComponent(join(dir, 'locked.txt'))}`);
  assert.equal(res.status, 403);
  assert.equal((await res.json() as { code?: string }).code, 'PERMISSION_DENIED');
});
