import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocketHandler } from './handler.js';
import { AuthService } from '../services/AuthService.js';
import type { Server, Socket } from 'socket.io';
import type { SessionManager } from '../services/SessionManager.js';
import type { UpdateService } from '../services/UpdateService.js';

// The `ephemeral:*` terminal events had no client (nothing in client/ or
// electron/ ever emitted them), yet any authenticated socket could spawn a login
// shell under an id it chose — ids not tied to the socket, so one client could
// type into or kill another's shell. Removed; this pins that they stay gone.
test('the socket handler registers no ephemeral:* events', () => {
  let connection: ((socket: Socket) => void) | undefined;
  const io = {
    use: () => io,
    on: (ev: string, fn: (socket: Socket) => void) => { if (ev === 'connection') connection ??= fn; return io; },
    to: () => ({ emit: () => {} }),
  };
  setupSocketHandler(
    io as unknown as Server,
    {} as SessionManager,
    new AuthService(),
    { broadcastToSocket: () => {}, checkForUpdate: async () => {} } as unknown as UpdateService,
  );
  const events: string[] = [];
  connection!({
    id: 's1',
    handshake: { auth: {}, query: {} },
    on: (ev: string) => { events.push(ev); },
    emit: () => {},
  } as unknown as Socket);
  assert.ok(events.includes('session:input'), 'sanity: real handlers were registered');
  assert.deepEqual(events.filter((e) => e.startsWith('ephemeral:')), []);
});
