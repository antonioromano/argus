import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { SessionManager } from './SessionManager.js';

process.env.ARGUS_PTY_BACKEND = 'tmux';

const cfg = (defaultRunMode?: 'persistent' | 'direct') => ({
  load: async () => ({ defaultAgent: 'claude', customAgents: [], agentFlags: {}, ...(defaultRunMode ? { defaultRunMode } : {}) }),
  save: async () => {},
}) as any;

function fakeBackend(kind: string, persistent: boolean) {
  const log: string[] = [];
  const pty = () => ({
    pid: 1, cols: 120, rows: 30, process: 'x', handleFlowControl: false,
    onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }),
    write: (d: string) => log.push(`write:${d}`), resize() {}, clear() {}, kill() {}, pause() {}, resume() {},
  });
  return {
    log,
    b: {
      kind, isPersistent: () => persistent,
      spawn: (o: any) => { log.push(`spawn:${o.sessionId}`); return pty(); },
      seedMirror: () => {}, writeWheel: (id: string) => log.push(`wheel:${id}`),
      detach: () => log.push('detach'), stopSession: (id: string) => log.push(`stop:${id}`),
      stopAll: () => log.push('stopAll'), listSurvivors: async () => new Set<string>(),
      isSurvivorDead: () => true, reapOrphans: async () => {},
    },
  };
}

function withBackends(defaultRunMode?: 'persistent' | 'direct') {
  const sm = new SessionManager(os.tmpdir(), cfg(defaultRunMode));
  const persistent = fakeBackend('daemon', true);
  const direct = fakeBackend('direct', false);
  (sm as any).backend = persistent.b;
  (sm as any).directBackend = direct.b;
  (sm as any).persistSessions = async () => {};
  (sm as any).fileWatcher = { watch() {}, stop: async () => {}, stopAll: async () => {} };
  return { sm, persistent, direct };
}

test('a direct session spawns through the direct backend, a persistent one through the app backend', async () => {
  const { sm, persistent, direct } = withBackends();
  const d = await sm.createSession(os.tmpdir(), 'd', 'claude', [], undefined, undefined, undefined, undefined, false, undefined, 'direct');
  const p = await sm.createSession(os.tmpdir(), 'p', 'claude', [], undefined, undefined, undefined, undefined, false, undefined, 'persistent');
  assert.equal(d.runMode, 'direct');
  assert.equal(p.runMode, 'persistent');
  assert.deepEqual(direct.log, [`spawn:${d.id}`]);
  assert.deepEqual(persistent.log, [`spawn:${p.id}`]);
});

test('with no run mode given, the config default decides', async () => {
  const { sm, direct } = withBackends('direct');
  const s = await sm.createSession(os.tmpdir(), 's', 'claude', []);
  assert.equal(s.runMode, 'direct');
  assert.deepEqual(direct.log, [`spawn:${s.id}`]);
});

test('an unknown run mode falls back to the config default', async () => {
  const { sm } = withBackends();
  const s = await sm.createSession(os.tmpdir(), 's', 'claude', [], undefined, undefined, undefined, undefined, false, undefined, 'sometimes' as any);
  assert.equal(s.runMode, 'persistent');
});

test('destroy, wheel and restart each go through the session\'s own backend', async () => {
  const { sm, persistent, direct } = withBackends();
  const d = await sm.createSession(os.tmpdir(), 'd', 'claude', [], undefined, undefined, undefined, undefined, false, undefined, 'direct');
  direct.log.length = 0;
  sm.writeToSession(d.id, '\x1b[<64;1;1M');
  await sm.restartSession(d.id);
  await sm.destroySession(d.id);
  assert.ok(direct.log.includes(`wheel:${d.id}`), direct.log.join(','));
  assert.ok(direct.log.includes(`spawn:${d.id}`), direct.log.join(','));
  assert.ok(direct.log.includes(`stop:${d.id}`), direct.log.join(','));
  assert.deepEqual(persistent.log, []);
});

test('Quit & Stop All stops direct agents as well as persistent ones', async () => {
  const { sm, persistent, direct } = withBackends();
  await sm.createSession(os.tmpdir(), 'd', 'claude', [], undefined, undefined, undefined, undefined, false, undefined, 'direct');
  await sm.stopAllAndShutdown();
  assert.ok(persistent.log.includes('stopAll'));
  assert.ok(direct.log.includes('stopAll'));
});

test('a plain quit detaches every session through its own backend (direct agents die, persistent survive)', async () => {
  const { sm, persistent, direct } = withBackends();
  await sm.createSession(os.tmpdir(), 'd', 'claude', [], undefined, undefined, undefined, undefined, false, undefined, 'direct');
  await sm.createSession(os.tmpdir(), 'p', 'claude', [], undefined, undefined, undefined, undefined, false, undefined, 'persistent');
  direct.log.length = 0; persistent.log.length = 0;
  await sm.shutdown();
  assert.deepEqual(direct.log, ['detach']);
  assert.deepEqual(persistent.log, ['detach']);
});

test('runMode is persisted', async () => {
  const { sm } = withBackends();
  let saved: any[] = [];
  (sm as any).store = { save: async (d: any[]) => { saved = d; }, load: async () => [] };
  delete (sm as any).persistSessions; // use the real one against the fake store
  await sm.createSession(os.tmpdir(), 'd', 'claude', [], undefined, undefined, undefined, undefined, false, undefined, 'direct');
  assert.equal(saved[0].runMode, 'direct');
});
