import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocketHandler } from './handler.js';
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

function fakeSocket(token?: string): Socket {
  return { handshake: { auth: { token }, query: {} } } as unknown as Socket;
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
