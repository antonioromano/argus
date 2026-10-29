import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { SessionManager } from './SessionManager.js';

process.env.ARGUS_PTY_BACKEND = 'tmux';

// Reopen after a close (plan 004 U8): the old conversation comes back through
// `claude --resume <id>`, spawn-only, like restartSession's resume.

const cfg = { load: async () => ({ defaultAgent: 'claude', customAgents: [], agentFlags: {} }), save: async () => {} } as any;
const CONVO = '0f8fad5b-d9cb-469f-a165-70867728950e';

function harness() {
  const sm = new SessionManager(os.tmpdir(), cfg);
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

const create = (sm: SessionManager, agent: string, flags: string[], opts: any) =>
  sm.createSession(os.tmpdir(), 'n', agent, flags, undefined, undefined, undefined, undefined, false, undefined, 'persistent', false, opts);

test('a reopen spawns --resume <id> first and keeps session.flags unchanged', async () => {
  const { sm, spawns, persisted } = harness();
  const s = await create(sm, 'claude', ['--model=opus', '--continue'], { resumeClaudeSessionId: CONVO });
  const flags: string[] = spawns[0].flags;
  assert.deepEqual(flags.slice(0, 2), ['--resume', CONVO]);
  assert.ok(flags.includes('--model=opus'));
  assert.ok(!flags.includes('--continue'), 'a stored conversation flag cannot fight the resume');
  assert.deepEqual(s.flags, ['--model=opus', '--continue']);
  assert.equal(s.claudeSessionId, CONVO);
  const rec = persisted.at(-1)!.find((p: any) => p.id === s.id);
  assert.deepEqual(rec.flags, ['--model=opus', '--continue']);
});

test('a reopen of a non-Claude agent is refused before spawning', async () => {
  const { sm, spawns } = harness();
  await assert.rejects(create(sm, 'shell', [], { resumeClaudeSessionId: CONVO }), /Only Claude/);
  assert.equal(spawns.length, 0);
});

test('an invalid conversation id never reaches argv', async () => {
  const { sm, spawns } = harness();
  await assert.rejects(create(sm, 'claude', [], { resumeClaudeSessionId: '--dangerous; rm -rf /' }), /Invalid Claude session id/);
  assert.equal(spawns.length, 0);
});

test('a plain restart of a reopened session starts fresh, without --resume', async () => {
  const { sm, spawns } = harness();
  const s = await create(sm, 'claude', [], { resumeClaudeSessionId: CONVO });
  await sm.restartSession(s.id);
  assert.ok(!spawns[1].flags.includes('--resume'));
});
