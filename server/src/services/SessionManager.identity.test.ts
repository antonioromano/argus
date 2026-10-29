import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { SessionManager } from './SessionManager.js';
import type { PersistedSession } from '../persistence/SessionStore.js';

process.env.ARGUS_PTY_BACKEND = 'tmux';

// setSessionIdentity is cosmetic like rename: it must persist (so a restart
// keeps it), broadcast once, and leave fields it was not given alone.

function fixture() {
  const configStore = {
    load: async () => ({ defaultAgent: 'claude', customAgents: [], agentFlags: {} }),
    save: async () => {},
  } as any;
  const sm = new SessionManager(os.tmpdir(), configStore);

  const emitted: Array<{ event: string; payload: any }> = [];
  (sm as any).io = {
    to: () => ({ emit: () => {} }),
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
  };

  const saves: PersistedSession[][] = [];
  (sm as any).store = { save: async (d: PersistedSession[]) => { saves.push(d); }, load: async () => [] };

  const session = {
    id: 'sess-1', name: 'api', folderPath: os.tmpdir(), agentType: 'claude', flags: [],
    status: 'idle', createdAt: new Date().toISOString(),
    pty: { resize: () => {} },
    stateDetector: { destroy: () => {} },
  };
  (sm as any).sessions.set('sess-1', session);
  return { sm, emitted, saves, session };
}

test('sets colour and emoji, persists both and broadcasts session:identity once', async () => {
  const f = fixture();
  const info = await f.sm.setSessionIdentity('sess-1', { color: 'teal', emoji: '🦊' });

  assert.equal(info.color, 'teal');
  assert.equal(info.emoji, '🦊');
  assert.equal(f.saves.length, 1);
  assert.equal(f.saves[0][0].color, 'teal');
  assert.equal(f.saves[0][0].emoji, '🦊');
  assert.deepEqual(f.emitted, [{ event: 'session:identity', payload: { sessionId: 'sess-1', color: 'teal', emoji: '🦊' } }]);
});

test('an omitted field is kept and null clears', async () => {
  const f = fixture();
  await f.sm.setSessionIdentity('sess-1', { color: 'teal', emoji: '🦊' });
  const kept = await f.sm.setSessionIdentity('sess-1', { emoji: null });
  assert.equal(kept.color, 'teal');
  assert.equal(kept.emoji, undefined);
  assert.deepEqual(f.emitted.at(-1)?.payload, { sessionId: 'sess-1', color: 'teal', emoji: null });
});

test('a rename leaves the identity intact', async () => {
  const f = fixture();
  await f.sm.setSessionIdentity('sess-1', { color: 'pink', emoji: '🚀' });
  const info = await f.sm.renameSession('sess-1', 'billing');
  assert.equal(info.color, 'pink');
  assert.equal(info.emoji, '🚀');
  assert.equal(f.saves.at(-1)?.[0].emoji, '🚀');
});

test('an unknown id throws without persisting', async () => {
  const f = fixture();
  await assert.rejects(() => f.sm.setSessionIdentity('ghost', { color: 'blue' }), /not found/);
  assert.equal(f.saves.length, 0);
  assert.equal(f.emitted.length, 0);
});
