import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocketHandler, dropUnauthorizedSockets } from './handler.js';
import { AuthService } from '../services/AuthService.js';
import type { Server, Socket } from 'socket.io';
import type { SessionManager } from '../services/SessionManager.js';
import type { UpdateService } from '../services/UpdateService.js';

type Middleware = (socket: Socket, next: (err?: Error) => void) => void;

/** Captures the io.use() auth gate without spinning up a real socket. */
function captureAuthGate(authService: AuthService): Middleware {
  let captured: Middleware | undefined;
  const fakeIo = {
    use(fn: Middleware) {
      captured ??= fn;
      return fakeIo;
    },
    on() {
      return fakeIo;
    },
  };
  setupSocketHandler(
    fakeIo as unknown as Server,
    {} as SessionManager,
    authService,
    { broadcastToSocket: () => {}, checkForUpdate: async () => {} } as unknown as UpdateService,
  );
  assert.ok(captured, 'expected io.use() to register the auth gate');
  return captured;
}

function fakeSocket(
  token?: string,
  headers: Record<string, string> = { host: '127.0.0.1:5757' },
  remoteAddress = '127.0.0.1',
): Socket {
  return {
    handshake: { auth: { token }, query: {} },
    request: { headers, socket: { remoteAddress } },
    data: {},
  } as unknown as Socket;
}

function gateResult(auth: AuthService, socket: Socket): Error | undefined {
  const gate = captureAuthGate(auth);
  let err: Error | undefined;
  gate(socket, (e) => { err = e; });
  return err;
}

test('not enforced (no exposure, no password): connection accepted without a token', () => {
  const auth = new AuthService();
  const gate = captureAuthGate(auth);
  let err: Error | undefined;
  gate(fakeSocket(), (e) => { err = e; });
  assert.equal(err, undefined);
});

test('enforced + valid token: accepted', () => {
  const auth = new AuthService();
  auth.setPassword('pw');
  const token = auth.generateToken();
  const gate = captureAuthGate(auth);
  let err: Error | undefined;
  gate(fakeSocket(token), (e) => { err = e; });
  assert.equal(err, undefined);
});

test('enforced + missing token: rejected', () => {
  const auth = new AuthService();
  auth.setPassword('pw');
  const gate = captureAuthGate(auth);
  let err: Error | undefined;
  gate(fakeSocket(), (e) => { err = e; });
  assert.ok(err instanceof Error);
});

test('enforced + invalid/expired token: rejected', () => {
  const auth = new AuthService();
  auth.setPassword('pw');
  const gate = captureAuthGate(auth);
  let err: Error | undefined;
  gate(fakeSocket('not-a-real-token'), (e) => { err = e; });
  assert.ok(err instanceof Error);
});

test('exposed but no password set: rejected (fail-closed, the #1 bug)', () => {
  const auth = new AuthService();
  auth.setExposed(true);
  assert.equal(auth.enabled, false);
  const gate = captureAuthGate(auth);
  let err: Error | undefined;
  gate(fakeSocket(), (e) => { err = e; });
  assert.ok(err instanceof Error, 'network-exposed instance with no password must reject sockets');
});

// S3: "exposed" used to mean only "Argus started ngrok itself". A tunnel the
// user ran by hand dials 127.0.0.1, so its sockets were admitted with no token.
for (const [label, headers] of [
  ['X-Forwarded-For', { host: '127.0.0.1:5757', 'x-forwarded-for': '203.0.113.9' }],
  ['Forwarded', { host: '127.0.0.1:5757', forwarded: 'for=203.0.113.9' }],
  ['ngrok edge header', { host: '127.0.0.1:5757', 'ngrok-trace-id': 'abc' }],
  ['tunnel Host', { host: 'abc.ngrok-free.app' }],
  ['LAN Host', { host: '192.168.1.20:5757' }],
] as const) {
  test(`manual tunnel (${label}), no password: socket rejected (fail-closed)`, () => {
    const auth = new AuthService();
    assert.equal(auth.enforced, false, 'global flag is off — only the request reveals the tunnel');
    assert.ok(gateResult(auth, fakeSocket(undefined, { ...headers })) instanceof Error);
  });
}

test('manual tunnel with a password: needs a valid token', () => {
  const auth = new AuthService();
  auth.setPassword('pw');
  const token = auth.generateToken();
  const tunneled = { host: '127.0.0.1:5757', 'x-forwarded-for': '203.0.113.9' };
  assert.ok(gateResult(auth, fakeSocket(undefined, tunneled)) instanceof Error);
  assert.equal(gateResult(auth, fakeSocket(token, tunneled)), undefined);
});

test('our own client header (ngrok-skip-browser-warning) does not mark a local socket exposed', () => {
  const auth = new AuthService();
  const err = gateResult(auth, fakeSocket(undefined, { host: '127.0.0.1:5757', 'ngrok-skip-browser-warning': 'true' }));
  assert.equal(err, undefined);
});

test('the handshake records token + exposure on socket.data for later re-checks', () => {
  const auth = new AuthService();
  const s = fakeSocket('t1');
  gateResult(auth, s);
  assert.deepEqual(s.data, { token: 't1', exposedRequest: false });
});

// S11: sockets were only checked at the handshake.
function fakeIo(sockets: Socket[]) {
  return { sockets: { sockets: new Map(sockets.map((s, i) => [String(i), s])) } } as unknown as Server;
}
function liveSocket(data: { token?: string; exposedRequest?: boolean }) {
  const s = { data, disconnected: false, disconnect() { s.disconnected = true; } };
  return s;
}

test('dropUnauthorizedSockets: enforcement turning on drops sockets without a valid token', () => {
  const auth = new AuthService();
  const local = liveSocket({ exposedRequest: false });
  const io = fakeIo([local as unknown as Socket]);
  assert.equal(dropUnauthorizedSockets(io, auth), 0, 'no password, loopback: kept');
  auth.setPassword('pw');
  const token = auth.generateToken();
  const authed = liveSocket({ token, exposedRequest: false });
  const io2 = fakeIo([local as unknown as Socket, authed as unknown as Socket]);
  assert.equal(dropUnauthorizedSockets(io2, auth), 1);
  assert.equal(local.disconnected, true);
  assert.equal(authed.disconnected, false);
});

test('dropUnauthorizedSockets: a password change revokes the old tokens', () => {
  const auth = new AuthService();
  auth.setPassword('pw-one');
  const old = liveSocket({ token: auth.generateToken(), exposedRequest: true });
  auth.setPassword('pw-two');
  assert.equal(dropUnauthorizedSockets(fakeIo([old as unknown as Socket]), auth), 1);
  assert.equal(old.disconnected, true);
});

test('dropUnauthorizedSockets: an exposed socket is dropped when auth is cleared while still exposed', () => {
  const auth = new AuthService();
  auth.setPassword('pw');
  auth.setExposed(true);
  const s = liveSocket({ token: auth.generateToken(), exposedRequest: false });
  auth.clearAuth();
  assert.equal(dropUnauthorizedSockets(fakeIo([s as unknown as Socket]), auth), 1);
});

test('setupSocketHandler re-checks live sockets the moment a password is set', () => {
  const auth = new AuthService();
  const s = liveSocket({ exposedRequest: false });
  const io = {
    use: () => io,
    on: () => io,
    sockets: { sockets: new Map([['a', s]]) },
  };
  setupSocketHandler(
    io as unknown as Server,
    {} as SessionManager,
    auth,
    { broadcastToSocket: () => {}, checkForUpdate: async () => {} } as unknown as UpdateService,
  );
  assert.equal(s.disconnected, false);
  auth.setPassword('pw');
  assert.equal(s.disconnected, true, 'a socket admitted before enforcement must not keep its session');
});
