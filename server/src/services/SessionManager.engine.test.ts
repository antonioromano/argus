import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { SessionManager } from './SessionManager.js';

process.env.ARGUS_PTY_BACKEND = 'tmux';

const cfg = (defaultTerminalEngine?: 'web' | 'native') => ({
  load: async () => ({
    defaultAgent: 'claude', customAgents: [], agentFlags: {},
    ...(defaultTerminalEngine ? { defaultTerminalEngine } : {}),
  }),
  save: async () => {},
}) as any;

/** toSessionInfo is what reaches the client and what gets persisted. */
function infoFor(sm: SessionManager, session: any) {
  (sm as any).sessions.set(session.id, session);
  return (sm as any).toSessionInfo(session);
}

test('terminalEngine round-trips through toSessionInfo', () => {
  const sm = new SessionManager(os.tmpdir(), cfg());
  const info = infoFor(sm, {
    id: 's1', name: 'n', folderPath: '/tmp', status: 'idle',
    createdAt: new Date().toISOString(), agentType: 'claude', flags: [],
    terminalEngine: 'native',
  });
  assert.equal(info.terminalEngine, 'native');
});

test('a session with no engine reports undefined, not a fabricated default', () => {
  // The RENDERER resolves the default. Baking one in here would make an
  // explicit 'web' choice indistinguishable from "never chose", which matters
  // if the app default later changes.
  const sm = new SessionManager(os.tmpdir(), cfg('native'));
  const info = infoFor(sm, {
    id: 's2', name: 'n', folderPath: '/tmp', status: 'idle',
    createdAt: new Date().toISOString(), agentType: 'claude', flags: [],
  });
  assert.equal(info.terminalEngine, undefined);
});

test('an invalid engine value is rejected at the boundary', () => {
  const sm = new SessionManager(os.tmpdir(), cfg());
  assert.equal((sm as any).normalizeTerminalEngine('native'), 'native');
  assert.equal((sm as any).normalizeTerminalEngine('web'), 'web');
  assert.equal((sm as any).normalizeTerminalEngine('gpu'), undefined);
  assert.equal((sm as any).normalizeTerminalEngine(undefined), undefined);
  assert.equal((sm as any).normalizeTerminalEngine(''), undefined);
});
