import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { ConfigStore } from '../persistence/ConfigStore.js';
import { createConfigRoutes } from './config.js';
import { errorHandler } from '../middleware/errorHandler.js';

// A rejected ConfigStore.load() inside GET /config must be caught by asyncHandler
// and returned as a 500 through the terminal errorHandler, never hang.

let server: Server;
let base: string;

before(async () => {
  const rejectingStore = {
    load: async () => { throw new Error('config unreadable'); },
    save: async () => {},
  } as unknown as ConfigStore;

  const app = express();
  app.use(express.json());
  app.use('/config', createConfigRoutes(rejectingStore));
  app.use(errorHandler);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}/config`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('rejected store load in GET /config returns 500 (not a hang)', async () => {
  const res = await fetch(base);
  assert.equal(res.status, 500);
  const body = await res.json() as { error?: string };
  assert.equal(body.error, 'Internal server error');
});
