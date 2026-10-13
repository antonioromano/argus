import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocketHandler } from './handler.js';
import { AuthService } from '../services/AuthService.js';
import type { Server, Socket } from 'socket.io';
import type { SessionManager } from '../services/SessionManager.js';
import type { UpdateService } from '../services/UpdateService.js';

type Handler = (...args: any[]) => void;

/** Real connection handler over a fake socket; records writes reaching the manager. */
function harness() {
  const writes: Array<[string, string]> = [];
  const sessions = new Map<string, { id: string; status: string }>([
    ['a', { id: 'a', status: 'idle' }],
    ['b', { id: 'b', status: 'waiting' }],
    ['x', { id: 'x', status: 'exited' }],
  ]);
  const manager = {
    getSession: (id: string) => sessions.get(id),
    writeToSession: (id: string, data: string) => { writes.push([id, data]); },
    checkPromptAnswer: (id: string, key: string) => (id === 'b' && key === '1' ? null : 'The prompt changed — open the shell to answer'),
  } as unknown as SessionManager;
  let connection: ((socket: Socket) => void) | undefined;
  const io = {
    use: () => io,
    on: (ev: string, fn: (socket: Socket) => void) => { if (ev === 'connection') connection ??= fn; return io; },
    to: () => ({ emit: () => {} }),
  };
  setupSocketHandler(io as unknown as Server, manager, new AuthService(),
    { broadcastToSocket: () => {}, checkForUpdate: async () => {} } as unknown as UpdateService);
  const on = new Map<string, Handler>();
  connection!({ id: 'sock', handshake: { auth: {}, query: {} }, on: (ev: string, fn: Handler) => { on.set(ev, fn); }, emit: () => {} } as unknown as Socket);
  const broadcast = (payload: unknown) => new Promise<any>((resolve) => on.get('session:broadcast')!(payload, resolve));
  const fireNoAck = (payload: unknown) => on.get('session:broadcast')!(payload);
  const answer = (payload: unknown) => new Promise<any>((resolve) => on.get('session:answer')!(payload, resolve));
  return { broadcast, fireNoAck, answer, writes };
}

test('session:broadcast writes to every live target via writeToSession and acks the count', async () => {
  const { broadcast, writes } = harness();
  const res = await broadcast({ sessionIds: ['a', 'b', 'x'], text: '/compact', enter: false });
  assert.deepEqual(res, { ok: true, sent: 2, skipped: 1 });
  assert.deepEqual(writes, [['a', '/compact'], ['b', '/compact']]);
});

test('session:broadcast rejects unknown ids without writing anything', async () => {
  const { broadcast, writes } = harness();
  const res = await broadcast({ sessionIds: ['a', 'ghost'], text: 'hi' });
  assert.equal(res.ok, false);
  assert.equal(writes.length, 0);
});

test('session:broadcast is rate limited per socket', async () => {
  const { broadcast } = harness();
  const results = [];
  for (let i = 0; i < 6; i++) results.push(await broadcast({ sessionIds: ['a'], text: `n${i}` }));
  assert.deepEqual(results.map((r) => r.ok), [true, true, true, true, true, false]);
  assert.match(results[5].error, /Too many broadcasts/);
});

test('session:broadcast tolerates a missing ack', () => {
  const { fireNoAck, writes } = harness();
  assert.doesNotThrow(() => fireNoAck({ sessionIds: ['a'], text: 'ok' }));
  assert.doesNotThrow(() => fireNoAck({ sessionIds: ['ghost'], text: 'ok' }));
  assert.deepEqual(writes, [['a', 'ok']]);
});

test('session:answer writes the digit only when the manager confirms the menu has it', async () => {
  const { answer, writes } = harness();
  assert.deepEqual(await answer({ sessionId: 'b', key: '1' }), { ok: true });
  assert.deepEqual(writes, [['b', '1']]);
  const refused = await answer({ sessionId: 'b', key: '2' });
  assert.equal(refused.ok, false);
  assert.equal((await answer({ key: '1' })).ok, false);
  assert.equal(writes.length, 1);
});
