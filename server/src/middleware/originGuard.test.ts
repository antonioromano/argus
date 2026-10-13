import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOriginGuard } from './originGuard.js';

let tunnel: string | undefined;
const guard = createOriginGuard({
  staticOrigins: ['http://127.0.0.1:5757', 'http://localhost:5402'],
  tunnelUrl: () => tunnel,
});
const ok = (headers: Record<string, string>) => guard.check(headers);

test('the renderer, the Vite dev client and non-browser callers pass', () => {
  assert.ok(ok({ host: '127.0.0.1:5757', origin: 'http://127.0.0.1:5757' }));
  assert.ok(ok({ host: 'localhost:5402', origin: 'http://localhost:5402' }));
  assert.ok(ok({ host: '127.0.0.1:5757' }), 'curl / agent hooks send no Origin');
  assert.ok(ok({ host: '[::1]:5757' }));
});

test('a foreign web page is refused (cross-site WS / form POST)', () => {
  assert.equal(ok({ host: '127.0.0.1:5757', origin: 'https://evil.example' }), false);
  assert.equal(ok({ host: '127.0.0.1:5757', origin: 'null' }), false, 'sandboxed iframe / file://');
  assert.equal(ok({ host: '127.0.0.1:5757', origin: 'http://127.0.0.1:9999' }), false, 'other local port');
});

test('DNS rebinding is refused: a domain name Host that is not the tunnel', () => {
  assert.equal(ok({ host: 'evil.example:5757', origin: 'http://evil.example:5757' }), false);
  assert.equal(ok({ host: 'evil.example:5757' }), false);
  assert.equal(ok({}), false, 'no Host at all');
});

test('the live tunnel is allowed only while it is up', () => {
  tunnel = 'https://abc.ngrok.app';
  assert.ok(ok({ host: 'abc.ngrok.app', origin: 'https://abc.ngrok.app' }));
  tunnel = undefined;
  assert.equal(ok({ host: 'abc.ngrok.app', origin: 'https://abc.ngrok.app' }), false);
});

test('LAN use (ARGUS_HOST=0.0.0.0) works same-origin on an IP literal', () => {
  assert.ok(ok({ host: '192.168.1.20:5757', origin: 'http://192.168.1.20:5757' }));
  assert.equal(ok({ host: '192.168.1.20:5757', origin: 'http://192.168.1.99:5757' }), false);
});
