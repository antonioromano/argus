import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocketHandler } from './handler.js';
import { AuthService } from '../services/AuthService.js';
import type { Server, Socket } from 'socket.io';
import type { SessionManager } from '../services/SessionManager.js';
import type { UpdateService } from '../services/UpdateService.js';

type Handler = (...args: any[]) => void;

interface Harness {
  connect: (id: string) => { fire: (ev: string, ...args: any[]) => void; has: (ev: string) => boolean };
  /** Every emit the connection handler made, in order. */
  emits: Array<{ ev: string; payload: any }>;
  /** Ordered log of the manager calls whose sequence matters. */
  calls: string[];
  /** Flavor argument of each getReplaySnapshot call. */
  flavors: Array<string | undefined>;
  /** Session ids the fake manager knows about. */
  known: Set<string>;
}

/**
 * Drive the real connection handler against a fake socket, recording the replay
 * frames it emits and the flavor it asked the manager for.
 */
function harness(): Harness {
  const rooms = new Map<string, Set<string>>();
  const emits: Harness['emits'] = [];
  const calls: string[] = [];
  const flavors: Array<string | undefined> = [];
  const known = new Set<string>(['sess-a']);

  const manager = {
    getSession: (id: string) => (known.has(id) ? { id } : undefined),
    flushOutput: () => { calls.push('flushOutput'); },
    getReplaySnapshot: (_id: string, flavor?: string) => {
      calls.push('getReplaySnapshot');
      flavors.push(flavor);
      return { data: 'FRAME', alternate: false, appMouse: false, sgr: true };
    },
    resizeSession: () => {},
    scheduleIdleGeometry: () => {},
    cancelIdleGeometry: () => {},
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
    emits,
    calls,
    flavors,
    known,
    connect(id: string) {
      const on = new Map<string, Handler>();
      const socket = {
        id,
        handshake: { auth: {}, query: {} },
        on: (ev: string, fn: Handler) => { on.set(ev, fn); },
        emit: (ev: string, payload: any) => { emits.push({ ev, payload }); },
        join: (room: string) => {
          if (!rooms.has(room)) rooms.set(room, new Set());
          rooms.get(room)!.add(id);
        },
        leave: (room: string) => { rooms.get(room)?.delete(id); },
      } as unknown as Socket;
      connection!(socket);
      return {
        has: (ev: string) => on.has(ev),
        fire: (ev: string, ...args: any[]) => {
          const fn = on.get(ev);
          assert.ok(fn, `no handler registered for ${ev}`);
          fn(...args);
        },
      };
    },
  };
}

const replays = (h: Harness) => h.emits.filter((e) => e.ev === 'session:replay');

test('session:resync serves a screen-flavored frame tagged resync', () => {
  const h = harness();
  const a = h.connect('sock-r1');
  a.fire('session:join', 'sess-a');
  h.emits.length = 0;
  h.flavors.length = 0;

  a.fire('session:resync', 'sess-a');

  assert.equal(replays(h).length, 1, 'exactly one frame for one resync');
  assert.deepEqual(h.flavors, ['screen'], 'a resync must ask for the screen-only frame');
  assert.equal(replays(h)[0].payload.reason, 'resync', 'frame must be tagged so the client skips its scroll guard');
  assert.equal(replays(h)[0].payload.sessionId, 'sess-a');
  assert.equal(replays(h)[0].payload.data, 'FRAME');
});

test('session:join still serves the full frame', () => {
  const h = harness();
  const a = h.connect('sock-r2');

  a.fire('session:join', 'sess-a');

  assert.deepEqual(h.flavors, [undefined], 'join must keep the default full frame');
  assert.notEqual(replays(h)[0].payload.reason, 'resync');
});

test('session:resync flushes coalesced output before building the frame', () => {
  const h = harness();
  const a = h.connect('sock-r3');
  a.fire('session:join', 'sess-a');
  h.calls.length = 0;

  a.fire('session:resync', 'sess-a');

  // Bytes still sitting in the coalescing buffer are already baked into the
  // mirror, so the frame covers them — flushing after would paint them twice.
  assert.deepEqual(h.calls, ['flushOutput', 'getReplaySnapshot']);
});

test('session:resync for an unknown session emits nothing', () => {
  const h = harness();
  const a = h.connect('sock-r4');

  a.fire('session:resync', 'sess-ghost');

  assert.deepEqual(replays(h), []);
  assert.deepEqual(h.calls, [], 'must not touch the manager for a session it does not have');
});
