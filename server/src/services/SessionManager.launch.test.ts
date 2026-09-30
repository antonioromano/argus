import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { SessionManager } from './SessionManager.js';

process.env.ARGUS_PTY_BACKEND = 'tmux';

const cfg = { load: async () => ({ defaultAgent: 'claude', customAgents: [], agentFlags: {} }), save: async () => {} } as any;

function harness() {
  const sm = new SessionManager(os.tmpdir(), cfg);
  sm.setSignalConfig('secret', '/opt/argus/bin/argus-signal');
  const spawns: any[] = [];
  const pty = () => ({
    pid: 1, cols: 120, rows: 30, process: 'x', handleFlowControl: false,
    onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }),
    write() {}, resize() {}, clear() {}, kill() {}, pause() {}, resume() {},
  });
  const b = {
    kind: 'daemon', isPersistent: () => true,
    spawn: (o: any) => { spawns.push(o); return pty(); },
    seedMirror() {}, writeWheel() {}, detach() {}, stopSession() {}, stopAll() {},
    listSurvivors: async () => new Set<string>(), isSurvivorDead: () => true, reapOrphans: async () => {},
  };
  (sm as any).backend = b;
  (sm as any).directBackend = b;
  const persisted: any[][] = [];
  (sm as any).store = { save: async (d: any[]) => { persisted.push(d); }, load: async () => persisted.at(-1) ?? [] };
  (sm as any).fileWatcher = { watch() {}, stop: async () => {}, stopAll: async () => {} };
  return { sm, spawns, persisted };
}

const create = (sm: SessionManager, flags: string[], opts: any) =>
  sm.createSession(os.tmpdir(), 'n', 'claude', flags, undefined, undefined, undefined, undefined, false, undefined, 'persistent', false, opts);

test('prompt is the last argv entry, after signal injection', async () => {
  const { sm, spawns } = harness();
  await create(sm, ['--model=opus'], { initialPrompt: 'settings=/x notify=x' });
  const flags: string[] = spawns[0].flags;
  assert.equal(flags.at(-1), 'settings=/x notify=x');
  const settingsIdx = flags.indexOf('--settings');
  assert.ok(settingsIdx >= 0 && settingsIdx < flags.length - 1, 'injected --settings precedes the prompt');
  assert.ok(!flags.includes('/x'), 'prompt never parsed as a --settings value');
});

test('prompt text that looks like injection flags is not parsed by the adapter', async () => {
  const { sm, spawns } = harness();
  await create(sm, [], { initialPrompt: 'use --settings=/tmp/evil.json please' });
  const flags: string[] = spawns[0].flags;
  assert.equal(flags.at(-1), 'use --settings=/tmp/evil.json please');
  assert.equal(flags.filter((f) => f === '--settings').length, 1, 'only Argus\'s own --settings');
});

test('session flags and persistence keep the original flags; prompt never persisted; launcherId persisted', async () => {
  const { sm, persisted } = harness();
  const s = await create(sm, ['--model=opus'], { initialPrompt: 'hello', launcherId: 'jarvar-refresh' });
  assert.deepEqual(s.flags, ['--model=opus']);
  assert.equal(s.launcherId, 'jarvar-refresh');
  const rec = persisted.at(-1)!.find((p: any) => p.id === s.id);
  assert.deepEqual(rec.flags, ['--model=opus']);
  assert.equal(rec.launcherId, 'jarvar-refresh');
  assert.ok(!JSON.stringify(persisted).includes('hello'));
});

test('restart does not replay the prompt', async () => {
  const { sm, spawns } = harness();
  const s = await create(sm, [], { initialPrompt: 'hello' });
  await sm.restartSession(s.id);
  assert.equal(spawns.length, 2);
  assert.ok(!spawns[1].flags.includes('hello'));
});

test('restore does not replay the prompt and keeps launcherId', async () => {
  const { sm, spawns } = harness();
  const s = await create(sm, [], { initialPrompt: 'hello', launcherId: 'l1' });
  (sm as any).sessions.clear();
  await sm.restoreSessions();
  const last = spawns.at(-1);
  assert.ok(!last.flags.includes('hello'));
  assert.equal(sm.findLiveByLauncher('l1')?.id, s.id);
});

test('findLiveByLauncher ignores exited sessions', async () => {
  const { sm } = harness();
  const s = await create(sm, [], { launcherId: 'l2' });
  (sm as any).sessions.get(s.id).status = 'exited';
  assert.equal(sm.findLiveByLauncher('l2'), undefined);
});

test('prompt on an agent without prompt support throws', async () => {
  const { sm } = harness();
  (sm as any).configStore = { load: async () => ({ defaultAgent: 'claude', customAgents: [{ id: 'x', name: 'X', command: 'x', builtin: false }], agentFlags: {} }) };
  await assert.rejects(
    sm.createSession(os.tmpdir(), 'n', 'x', [], undefined, undefined, undefined, undefined, false, undefined, 'persistent', false, { initialPrompt: 'hi' }),
    /does not accept an initial prompt/,
  );
});
