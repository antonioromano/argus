import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { createAuthMiddleware } from './auth.js';
import type { AuthService } from '../services/AuthService.js';

const enforced = {
  exposed: true,
  enabled: true,
  enforced: true,
  validateToken: (t: string) => t === 'good',
} as unknown as AuthService;

async function serve(caseSensitive: boolean): Promise<{ base: string; close: () => Promise<void> }> {
  const app = express();
  if (caseSensitive) app.set('case sensitive routing', true);
  app.use(createAuthMiddleware(enforced));
  const r = express.Router();
  r.get('/', (_req, res) => { res.json({ secret: true }); });
  app.use('/api/sessions', r);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((res) => server.close(() => res())),
  };
}

// Regression: `/API/sessions` used to return 200 with no token, because routing
// ignored case while the gate's startsWith('/api/') did not.
for (const caseSensitive of [false, true]) {
  test(`path case cannot bypass auth (case-sensitive routing: ${caseSensitive})`, async () => {
    const { base, close } = await serve(caseSensitive);
    try {
      for (const p of ['/api/sessions', '/API/sessions', '/Api/Sessions', '/api/SESSIONS']) {
        const res = await fetch(base + p);
        assert.notEqual(res.status, 200, `${p} must not be served without a token`);
      }
      const authed = await fetch(base + '/api/sessions', { headers: { authorization: 'Bearer good' } });
      assert.equal(authed.status, 200);
    } finally {
      await close();
    }
  });
}
