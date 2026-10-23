import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync, existsSync } from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { createChatImageRoutes } from './chatImages.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest')]);

async function withServer(fn: (base: string, dir: string) => Promise<void>) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'argus-chatimg-'));
  const app = express();
  app.use('/api/sessions', createChatImageRoutes({ isChatSession: (id) => id === 'c1', dir, maxAgeMs: 60_000 }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/sessions`;
  try {
    await fn(base, dir);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const post = (url: string, body: Buffer, type: string) => fetch(url, { method: 'POST', headers: { 'Content-Type': type }, body });

test('saves a pasted PNG privately and returns its path', async () => {
  await withServer(async (base, dir) => {
    const res = await post(`${base}/c1/chat-image`, PNG, 'image/png');
    assert.equal(res.status, 200);
    const { path: file } = (await res.json()) as { path: string };
    assert.equal(path.dirname(file), dir);
    assert.ok(file.endsWith('.png'));
    assert.deepEqual(readFileSync(file), PNG);
    assert.equal(statSync(file).mode & 0o777, 0o600);
  });
});

test('rejects unknown sessions, other types and bytes that are not the declared image', async () => {
  await withServer(async (base) => {
    assert.equal((await post(`${base}/nope/chat-image`, PNG, 'image/png')).status, 404);
    assert.equal((await post(`${base}/c1/chat-image`, Buffer.from('#!/bin/sh'), 'image/png')).status, 400);
    assert.equal((await post(`${base}/c1/chat-image`, PNG, 'text/plain')).status, 400);
    assert.equal((await post(`${base}/c1/chat-image`, PNG, 'image/jpeg')).status, 400);
  });
});

test('old images are swept on the next upload', async () => {
  await withServer(async (base, dir) => {
    const old = path.join(dir, 'old.png');
    writeFileSync(old, PNG);
    const past = new Date(Date.now() - 120_000);
    utimesSync(old, past, past);
    await post(`${base}/c1/chat-image`, PNG, 'image/png');
    assert.equal(existsSync(old), false);
  });
});
