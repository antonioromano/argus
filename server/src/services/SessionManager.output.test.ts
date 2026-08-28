import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { SessionManager } from './SessionManager.js';

process.env.ARGUS_PTY_BACKEND = 'tmux';

const fakeConfig = {
  load: async () => ({ defaultAgent: 'claude', customAgents: [], agentFlags: {} }),
  save: async () => {},
} as any;

function fixture() {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  const emits: any[] = [];
  (sm as any).io = {
    to: () => ({ emit: (event: string, payload: any) => emits.push({ event, payload }) }),
    emit: () => {},
  };
  (sm as any).sessions.set('s1', { id: 's1', pendingOutput: 'hello', flushTimer: undefined });
  return { sm, emits };
}

test('onOutput receives the same payload the socket room gets', () => {
  const { sm, emits } = fixture();
  const seen: Array<[string, string]> = [];
  sm.onOutput((id, data) => seen.push([id, data]));

  sm.flushOutput('s1');

  assert.deepEqual(seen, [['s1', 'hello']]);
  assert.equal(emits[0].payload.data, 'hello');
});

test('onOutput returns an unsubscribe that stops delivery', () => {
  const { sm } = fixture();
  const seen: string[] = [];
  const off = sm.onOutput((_id, data) => seen.push(data));
  off();

  sm.flushOutput('s1');

  assert.deepEqual(seen, []);
});

test('a throwing subscriber cannot break the socket emit', () => {
  // A native-side crash must never stop web clients from receiving output.
  const { sm, emits } = fixture();
  sm.onOutput(() => { throw new Error('addon exploded'); });

  sm.flushOutput('s1');

  assert.equal(emits[0].payload.data, 'hello');
});

test('no output means no notification', () => {
  const { sm } = fixture();
  (sm as any).sessions.set('s2', { id: 's2', pendingOutput: '', flushTimer: undefined });
  const seen: string[] = [];
  sm.onOutput((_id, d) => seen.push(d));

  sm.flushOutput('s2');

  assert.deepEqual(seen, []);
});
