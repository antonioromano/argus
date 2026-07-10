import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { SessionManager } from '../services/SessionManager.js';
import type { GitService } from '../services/GitService.js';
import type { ChangelistStore } from '../persistence/ChangelistStore.js';
import type { CommitSelectionStore } from '../persistence/CommitSelectionStore.js';
import { createGitRoutes } from './git.js';
import { errorHandler } from '../middleware/errorHandler.js';

// A rejected GitService call inside an async git route must be caught by
// asyncHandler and returned as a 500 through the terminal errorHandler, never hang.

let server: Server;
let base: string;

before(async () => {
  const manager = {
    getSessionInfo: (_id: string) => ({ id: _id, folderPath: '/tmp/repo' }),
  } as unknown as SessionManager;

  const gitService = {
    getDiff: async () => { throw new Error('git blew up'); },
    getBranches: async () => ({ branches: [], current: 'main' }),
  } as unknown as GitService;

  const changelistStore = {} as unknown as ChangelistStore;
  const commitSelectionStore = {} as unknown as CommitSelectionStore;

  const app = express();
  app.use(express.json());
  app.use('/api', createGitRoutes(manager, gitService, changelistStore, commitSelectionStore));
  app.use(errorHandler);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}/api`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('rejected gitService.getDiff returns 500 (not a hang)', async () => {
  const res = await fetch(`${base}/sessions/s1/diff`);
  assert.equal(res.status, 500);
  const body = await res.json() as { error?: string };
  assert.equal(body.error, 'Internal server error');
});

test('happy path GET git-branches is unchanged', async () => {
  const res = await fetch(`${base}/sessions/s1/git-branches`);
  assert.equal(res.status, 200);
  const body = await res.json() as { current: string };
  assert.equal(body.current, 'main');
});
