import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocketHandler } from './handler.js';
import { AuthService } from '../services/AuthService.js';
import type { Server, Socket } from 'socket.io';
import type { SessionManager } from '../services/SessionManager.js';
import type { UpdateService } from '../services/UpdateService.js';

type Handler = (...args: any[]) => void;

/** Drive the real connection handler's chat events against a fake socket and manager. */
function harness(opts: { claude?: boolean } = {}) {
  const rooms = new Map<string, Set<string>>();
  const emits: Array<{ ev: string; payload: any }> = [];
  const calls: string[] = [];
  const manager = {
    getSession: (id: string) => (id === 'sess-a' ? { id } : undefined),
    openChat: async (id: string) => {
      calls.push(`open:${id}`);
      return opts.claude === false ? undefined : { available: true, messages: [{ id: 'u1', role: 'user', blocks: [] }] };
    },
    closeChat: (id: string) => { calls.push(`close:${id}`); },
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
  const on = new Map<string, Handler>();
  const socket = {
    id: 's1',
    handshake: { auth: {}, query: {} },
    on: (ev: string, fn: Handler) => { on.set(ev, fn); },
    emit: (ev: string, payload: any) => { emits.push({ ev, payload }); },
    join: (room: string) => { if (!rooms.has(room)) rooms.set(room, new Set()); rooms.get(room)!.add('s1'); },
    leave: (room: string) => { rooms.get(room)?.delete('s1'); },
  } as unknown as Socket;
  connection!(socket);
  const fire = (ev: string, ...args: any[]) => on.get(ev)!(...args);
  const inRoom = () => rooms.get('chat:sess-a')?.has('s1') ?? false;
  return { emits, calls, fire, inRoom };
}

const tick = () => new Promise((r) => setImmediate(r));

test('subscribe joins the chat room and sends the snapshot as a reset', async () => {
  const h = harness();
  h.fire('session:chat:subscribe', 'sess-a');
  h.fire('session:chat:subscribe', 'sess-a'); // duplicate: ignored
  await tick();
  assert.equal(h.inRoom(), true);
  assert.deepEqual(h.calls, ['open:sess-a']);
  const chat = h.emits.filter((e) => e.ev === 'session:chat');
  assert.equal(chat.length, 1);
  assert.deepEqual(chat[0].payload, { sessionId: 'sess-a', reset: true, available: true, messages: [{ id: 'u1', role: 'user', blocks: [] }] });
});

test('unsubscribe and disconnect release the feed once', async () => {
  const h = harness();
  h.fire('session:chat:subscribe', 'sess-a');
  await tick();
  h.fire('session:chat:unsubscribe', 'sess-a');
  h.fire('session:chat:unsubscribe', 'sess-a');
  assert.equal(h.inRoom(), false);
  assert.deepEqual(h.calls, ['open:sess-a', 'close:sess-a']);

  h.fire('session:chat:subscribe', 'sess-a');
  await tick();
  h.fire('disconnect');
  assert.deepEqual(h.calls, ['open:sess-a', 'close:sess-a', 'open:sess-a', 'close:sess-a']);
});

test('unknown sessions error; non-Claude sessions answer unavailable and leave the room', async () => {
  const h = harness({ claude: false });
  h.fire('session:chat:subscribe', 'nope');
  assert.equal(h.emits[0]?.ev, 'session:error');
  h.fire('session:chat:subscribe', 'sess-a');
  await tick();
  assert.equal(h.inRoom(), false);
  const chat = h.emits.find((e) => e.ev === 'session:chat');
  assert.deepEqual(chat?.payload, { sessionId: 'sess-a', reset: true, available: false, messages: [] });
});
