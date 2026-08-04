import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocketHandler, MOBILE_MIN_ROWS } from './handler.js';
import { AuthService } from '../services/AuthService.js';
import type { Server, Socket } from 'socket.io';
import type { SessionManager } from '../services/SessionManager.js';
import type { UpdateService } from '../services/UpdateService.js';

type Handler = (...args: any[]) => void;

interface Harness {
  connect: (id: string, client?: 'mobile') => { on: Map<string, Handler>; fire: (ev: string, ...args: any[]) => void };
  resizes: Array<{ id: string; cols: number; rows: number }>;
  idled: string[];
  cancelled: string[];
}

/**
 * Drive the real connection handler against fake sockets. Rooms are a live
 * Map<sessionId, Set<socketId>> that join/leave mutate, because the leave branch
 * decides "is anyone still watching?" from io.sockets.adapter.rooms.
 */
function harness(): Harness {
  const rooms = new Map<string, Set<string>>();
  const resizes: Harness['resizes'] = [];
  const idled: string[] = [];
  const cancelled: string[] = [];

  const manager = {
    getSession: () => ({ id: 'x' }),
    flushOutput: () => {},
    getReplaySnapshot: () => undefined,
    resizeSession: (id: string, cols: number, rows: number) => { resizes.push({ id, cols, rows }); },
    scheduleIdleGeometry: (id: string) => { idled.push(id); },
    cancelIdleGeometry: (id: string) => { cancelled.push(id); },
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
    resizes,
    idled,
    cancelled,
    connect(id: string, client?: 'mobile') {
      const on = new Map<string, Handler>();
      const socket = {
        id,
        handshake: { auth: {}, query: client ? { client } : {} },
        on: (ev: string, fn: Handler) => { on.set(ev, fn); },
        emit: () => {},
        join: (room: string) => {
          if (!rooms.has(room)) rooms.set(room, new Set());
          rooms.get(room)!.add(id);
        },
        leave: (room: string) => {
          const r = rooms.get(room);
          r?.delete(id);
          if (r && r.size === 0) rooms.delete(room);
        },
      } as unknown as Socket;
      connection!(socket);
      return {
        on,
        fire: (ev: string, ...args: any[]) => {
          const fn = on.get(ev);
          assert.ok(fn, `no handler registered for ${ev}`);
          fn(...args);
        },
      };
    },
  };
}

test('the last viewer leaving hands the session a tall idle screen instead of leaving it tile-sized', () => {
  const h = harness();
  const a = h.connect('sock-a');
  a.fire('session:join', 'sess-solo');
  a.fire('session:resize', { sessionId: 'sess-solo', cols: 62, rows: 14 });
  h.resizes.length = 0;

  a.fire('session:leave', 'sess-solo');

  assert.deepEqual(h.idled, ['sess-solo'], 'an unattached session must be queued for the idle row floor');
  assert.deepEqual(h.resizes, [], 'no client dimensions remain to size it from');
});

test('a viewer disconnecting (window closed, app quit) also leaves a tall idle screen behind', () => {
  const h = harness();
  const a = h.connect('sock-d');
  a.fire('session:join', 'sess-disc');
  a.fire('session:resize', { sessionId: 'sess-disc', cols: 62, rows: 14 });
  h.resizes.length = 0;

  a.fire('disconnect');

  assert.deepEqual(h.idled, ['sess-disc']);
});

test('a viewer leaving while another stays sizes the pty to the survivor, not the idle floor', () => {
  const h = harness();
  const a = h.connect('sock-a2');
  const b = h.connect('sock-b2');
  a.fire('session:join', 'sess-pair');
  b.fire('session:join', 'sess-pair');
  a.fire('session:resize', { sessionId: 'sess-pair', cols: 62, rows: 14 });
  b.fire('session:resize', { sessionId: 'sess-pair', cols: 200, rows: 50 });
  h.resizes.length = 0;

  a.fire('session:leave', 'sess-pair');

  assert.deepEqual(h.resizes, [{ id: 'sess-pair', cols: 200, rows: 50 }]);
  assert.deepEqual(h.idled, [], 'someone is still watching — no idle floor');
});

test('a phone in landscape cannot shrink the pty below the mobile row floor', () => {
  const h = harness();
  const desktop = h.connect('sock-desk', undefined);
  const phone = h.connect('sock-phone', 'mobile');
  desktop.fire('session:join', 'sess-rot');
  phone.fire('session:join', 'sess-rot');
  desktop.fire('session:resize', { sessionId: 'sess-rot', cols: 200, rows: 50 });
  h.resizes.length = 0;

  // Rotating to landscape measured 104x8 on an iPhone 15 Pro.
  phone.fire('session:resize', { sessionId: 'sess-rot', cols: 104, rows: 8 });

  assert.deepEqual(
    h.resizes,
    [{ id: 'sess-rot', cols: 104, rows: MOBILE_MIN_ROWS }],
    'the phone still dictates width, but 8 rows must be lifted to the floor so the agent stays usable for every viewer',
  );
});

test('a phone in portrait is sized to its own rows, floor or no floor', () => {
  const h = harness();
  const phone = h.connect('sock-portrait', 'mobile');
  phone.fire('session:join', 'sess-portrait');
  h.resizes.length = 0;

  phone.fire('session:resize', { sessionId: 'sess-portrait', cols: 46, rows: 42 });

  assert.deepEqual(
    h.resizes,
    [{ id: 'sess-portrait', cols: 46, rows: 42 }],
    'portrait already clears the floor — the clamp must not alter the common case',
  );
});

test('the floor applies to a phone-only session too, not just when a desktop is watching', () => {
  const h = harness();
  const phone = h.connect('sock-solo-phone', 'mobile');
  phone.fire('session:join', 'sess-solo-rot');
  h.resizes.length = 0;

  phone.fire('session:resize', { sessionId: 'sess-solo-rot', cols: 104, rows: 8 });

  assert.deepEqual(h.resizes, [{ id: 'sess-solo-rot', cols: 104, rows: MOBILE_MIN_ROWS }]);
});

test('a viewer that rejoins cancels the pending idle resize, so a reconnect costs no repaint', () => {
  const h = harness();
  const a = h.connect('sock-r');
  a.fire('session:join', 'sess-flap');
  a.fire('session:resize', { sessionId: 'sess-flap', cols: 62, rows: 14 });

  a.fire('disconnect');
  assert.deepEqual(h.idled, ['sess-flap'], 'queued while nobody is watching');

  // Socket comes back (socket.io reconnect) and re-joins the room.
  const b = h.connect('sock-r2');
  b.fire('session:join', 'sess-flap');

  assert.ok(
    h.cancelled.includes('sess-flap'),
    'rejoining must cancel the queued idle resize instead of letting it SIGWINCH the agent',
  );
});
