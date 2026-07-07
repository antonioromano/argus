import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { SessionManager } from '../services/SessionManager.js';
import type { OrderStore } from '../persistence/OrderStore.js';
import type { GroupStore } from '../persistence/GroupStore.js';
import type { ConfigStore } from '../persistence/ConfigStore.js';
import { createSessionRoutes } from './sessions.js';
import { errorHandler } from '../middleware/errorHandler.js';

// Verifies that a rejected promise inside an async session route is caught by
// asyncHandler and surfaced as a 500 (via the terminal errorHandler) rather than
// hanging the request forever. Also asserts the happy path is unchanged.

let server: Server;
let base: string;

before(async () => {
  // orderStore.load() rejects — the GET /order handler awaits it.
  const rejectingOrderStore = {
    load: async () => { throw new Error('disk exploded'); },
    save: async () => {},
  } as unknown as OrderStore;

  // A well-behaved store for the mosaic-order happy-path check.
  let saved: string[] = ['a', 'b'];
  const okMosaicStore = {
    load: async () => saved,
    save: async (o: string[]) => { saved = o; },
  } as unknown as OrderStore;

  const groupStore = { load: async () => [], save: async () => {} } as unknown as GroupStore;
  const configStore = { load: async () => ({}), save: async () => {} } as unknown as ConfigStore;
  const manager = {} as unknown as SessionManager;

  const app = express();
  app.use(express.json());
  app.use('/api/sessions', createSessionRoutes(manager, rejectingOrderStore, okMosaicStore, groupStore, configStore));
  app.use(errorHandler);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}/api/sessions`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('rejected store load in GET /order returns 500 (not a hang)', async () => {
  const res = await fetch(`${base}/order`);
  assert.equal(res.status, 500);
  const body = await res.json() as { error?: string };
  assert.equal(body.error, 'Internal server error');
});

test('happy path GET /mosaic-order is unchanged', async () => {
  const res = await fetch(`${base}/mosaic-order`);
  assert.equal(res.status, 200);
  const body = await res.json() as { order: string[] };
  assert.deepEqual(body.order, ['a', 'b']);
});
