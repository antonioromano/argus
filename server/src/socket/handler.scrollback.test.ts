import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocketHandler } from './handler.js';
import { AuthService } from '../services/AuthService.js';
import type { Server, Socket } from 'socket.io';
import type { SessionManager } from '../services/SessionManager.js';
import type { UpdateService } from '../services/UpdateService.js';

type Handler = (...args: any[]) => void;

/**
 * Viewer presence must never cost a session its replay history.
 *
 * The mirror's scrollback is the ceiling on what any client can scroll back to:
 * a join answers with a full frame opening `ESC[3J`, which replaces whatever the
 * client held. So the moment the server trims the mirror, the rows are gone for
 * every future reader — an ordinary tile unmount (minimize, mosaic → focus) used
 * to drop the depth to 1000 rows permanently, and an idle session never refilled.
 *
 * These tests drive the real connection handler against a fake manager that
 * records any attempt to resize mirror history.
 */
function harness() {
  const rooms = new Map<string, Set<string>>();
  /** Every mirror-depth change the handler asked for. Must stay empty. */
  const depthCalls: Array<{ id: string; hasClients: boolean }> = [];
  const known = new Set<string>(['sess-a']);

  const manager = {
    getSession: (id: string) => (known.has(id) ? { id } : undefined),
    flushOutput: () => {},
    setMirrorScrollback: (id: string, hasClients: boolean) => { depthCalls.push({ id, hasClients }); },
    getReplaySnapshot: () => ({ data: 'FRAME', alternate: false, appMouse: false, sgr: true }),
    resizeSession: () => {},
    scheduleIdleGeometry: () => {},
    cancelIdleGeometry: () => {},
    companionTerminals: { resize: () => {} },
  } as unknown as SessionManager;

  let connection: ((socket: Socket) => void) | undefined;
  const io = {
    use: () => io,
    on: (ev: string, fn: (socket: Socket) => void) => { if (ev === 'connection') connection ??= fn; return io; },
    to: () => ({ emit: () => {} }),
    sockets: { adapter: { rooms } },
  };

  setupSocketHandler(
    io as unknown as Server,
    manager,
    new AuthService(),
    { broadcastToSocket: () => {}, checkForUpdate: async () => {} } as unknown as UpdateService,
  );
  assert.ok(connection, 'expected io.on("connection") to be registered');

  return {
    depthCalls,
    connect(id: string) {
      const on = new Map<string, Handler>();
      const socket = {
        id,
        handshake: { auth: {}, query: {} },
        rooms: new Set<string>(),
        on: (ev: string, fn: Handler) => { on.set(ev, fn); },
        emit: () => {},
        join: (room: string) => {
          if (!rooms.has(room)) rooms.set(room, new Set());
          rooms.get(room)!.add(id);
          (socket as unknown as { rooms: Set<string> }).rooms.add(room);
        },
        leave: (room: string) => {
          rooms.get(room)?.delete(id);
          (socket as unknown as { rooms: Set<string> }).rooms.delete(room);
        },
      } as unknown as Socket;
      connection!(socket);
      return {
        fire: (ev: string, ...args: any[]) => {
          const fn = on.get(ev);
          assert.ok(fn, `no handler registered for ${ev}`);
          fn(...args);
        },
      };
    },
  };
}

test('a viewer leaving does not shrink the session mirror', () => {
  const h = harness();
  const a = h.connect('sock-s1');
  a.fire('session:join', 'sess-a');

  a.fire('session:leave', 'sess-a');

  assert.deepEqual(
    h.depthCalls,
    [],
    'leaving a room must not resize mirror history — the trim is permanent and every later reader inherits the shallower depth',
  );
});

test('a disconnecting viewer does not shrink the session mirror', () => {
  const h = harness();
  const a = h.connect('sock-s2');
  a.fire('session:join', 'sess-a');

  a.fire('disconnect');

  assert.deepEqual(h.depthCalls, [], 'a dropped socket is just a viewer that left — history must survive it');
});

test('joining does not resize mirror history either', () => {
  const h = harness();
  const a = h.connect('sock-s3');

  a.fire('session:join', 'sess-a');

  assert.deepEqual(h.depthCalls, [], 'the mirror is created at full depth; a join has nothing to restore');
});
