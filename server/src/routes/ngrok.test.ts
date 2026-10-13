import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { createNgrokRoutes } from './ngrok.js';
import { AuthService } from '../services/AuthService.js';
import type { NgrokService } from '../services/NgrokService.js';

async function serve(ngrok: Partial<NgrokService>, auth: AuthService) {
  const app = express();
  app.use(express.json());
  app.use('/api/ngrok', createNgrokRoutes(ngrok as NgrokService, auth));
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const { port } = server.address() as AddressInfo;
  return {
    start: (password: string) => fetch(`http://127.0.0.1:${port}/api/ngrok/start`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }),
    }),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

const PW = 'correct-horse-battery-staple-9';

// S3: the password used to be set only AFTER ngrok came up, leaving the public
// URL unauthenticated for the ~1s spawn window.
test('tunnel start sets the password before ngrok is spawned', async () => {
  const auth = new AuthService();
  let enabledAtSpawn: boolean | undefined;
  const ngrok = {
    installed: true,
    start: async () => { enabledAtSpawn = auth.enabled; return 'https://x.ngrok.app'; },
    getStatus: () => ({ publicUrl: 'https://x.ngrok.app' }) as ReturnType<NgrokService['getStatus']>,
  };
  const srv = await serve(ngrok, auth);
  try {
    const res = await srv.start(PW);
    assert.equal(res.status, 200);
    const body = await res.json() as { token: string };
    assert.equal(enabledAtSpawn, true);
    assert.equal(auth.validateToken(body.token), true);
  } finally {
    await srv.close();
  }
});

test('a failed tunnel start does not leave behind a password the user never had', async () => {
  const auth = new AuthService();
  const ngrok = {
    installed: true,
    start: async () => { throw new Error('boom'); },
    getStatus: () => ({ publicUrl: null }) as ReturnType<NgrokService['getStatus']>,
  };
  const srv = await serve(ngrok, auth);
  try {
    assert.equal((await srv.start(PW)).status, 500);
    assert.equal(auth.enabled, false);
  } finally {
    await srv.close();
  }
});
