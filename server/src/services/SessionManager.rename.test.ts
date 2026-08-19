import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { SessionManager } from './SessionManager.js';

process.env.ARGUS_PTY_BACKEND = 'tmux';

// renameSession is display-only: the tmux session name is derived from the
// session id, so a rename must touch nothing but the label — while still being
// persisted and broadcast so other clients and the next app start agree on it.

interface Fixture {
  sm: SessionManager;
  emitted: Array<{ event: string; payload: any }>;
  persisted: () => number;
  session: any;
}

function fixture(id = 'sess-1', name = 'argus'): Fixture {
  const configStore = {
    load: async () => ({ defaultAgent: 'claude', customAgents: [], agentFlags: {} }),
    save: async () => {},
  } as any;
  const sm = new SessionManager(os.tmpdir(), configStore);

  const emitted: Fixture['emitted'] = [];
  (sm as any).io = {
    to: () => ({ emit: () => {} }),
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
  };

  let saves = 0;
  (sm as any).store = { save: async () => { saves += 1; }, load: async () => [] };

  const session = {
    id, name, folderPath: os.tmpdir(), agentType: 'claude', flags: [],
    status: 'idle', createdAt: new Date().toISOString(),
    pty: { resize: () => {} },
    stateDetector: { destroy: () => {} },
  };
  (sm as any).sessions.set(id, session);

  return { sm, emitted, persisted: () => saves, session };
}

test('renames the session, persists it, and broadcasts session:renamed', async () => {
  const f = fixture();
  const info = await f.sm.renameSession('sess-1', 'billing spike');

  assert.equal(info.name, 'billing spike');
  assert.equal(f.session.name, 'billing spike');
  assert.equal(f.persisted(), 1, 'rename must survive a restart');
  assert.deepEqual(f.emitted, [{ event: 'session:renamed', payload: { sessionId: 'sess-1', name: 'billing spike' } }]);
});

test('trims surrounding whitespace before storing', async () => {
  const f = fixture();
  const info = await f.sm.renameSession('sess-1', '   padded   ');
  assert.equal(info.name, 'padded');
});

test('caps an over-long name instead of storing it whole', async () => {
  const f = fixture();
  const info = await f.sm.renameSession('sess-1', 'x'.repeat(200));
  assert.equal(info.name.length, 60);
});

test('rejects a blank name without touching the session or persisting', async () => {
  const f = fixture('sess-1', 'original');
  await assert.rejects(() => f.sm.renameSession('sess-1', '  \t '), /cannot be empty/);
  assert.equal(f.session.name, 'original');
  assert.equal(f.persisted(), 0);
  assert.equal(f.emitted.length, 0);
});

test('rejects an unknown session id', async () => {
  const f = fixture();
  await assert.rejects(() => f.sm.renameSession('ghost', 'nope'), /not found/);
});

test('leaves the pty and tmux backend untouched (rename is cosmetic)', async () => {
  const f = fixture();
  const backendCalls: string[] = [];
  (f.sm as any).backend = new Proxy({}, {
    get: (_t, prop: string) => (...args: unknown[]) => { backendCalls.push(`${prop}(${args.join(',')})`); },
  });
  await f.sm.renameSession('sess-1', 'renamed');
  assert.deepEqual(backendCalls, []);
});
