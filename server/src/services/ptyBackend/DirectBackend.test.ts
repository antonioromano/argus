import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DirectBackend } from './DirectBackend.js';
import { InertPty } from './InertPty.js';

function fakePty() {
  const writes: string[] = [];
  let killed = 0;
  let exitListener: (() => void) | undefined;
  const p = {
    pid: 1, cols: 80, rows: 24, process: 'claude', handleFlowControl: false,
    onData: () => ({ dispose() {} }),
    onExit: (cb: () => void) => { exitListener = cb; return { dispose() {} }; },
    write: (d: string) => { writes.push(d); }, resize() {}, clear() {},
    kill: () => { killed++; }, pause() {}, resume() {},
  };
  return { p: p as any, writes, killedCount: () => killed, fireExit: () => exitListener?.() };
}

function harness() {
  const spawned: any[] = [];
  const ptys: ReturnType<typeof fakePty>[] = [];
  const mgr = {
    spawn: (...args: any[]) => { spawned.push(args); const f = fakePty(); ptys.push(f); return f.p; },
  };
  return { backend: new DirectBackend(mgr as any), spawned, ptys };
}

const opts = (sessionId: string) => ({
  sessionId, folderPath: '/tmp/x', command: 'claude', cols: 100, rows: 30,
  flags: ['--x'], extraEnv: { A: '1' }, attachExisting: false,
});

test('spawns through the plain no-tmux path with the session\'s folder, command, grid, flags and env', () => {
  const { backend, spawned } = harness();
  backend.spawn(opts('s1'));
  assert.deepEqual(spawned, [['/tmp/x', 'claude', 100, 30, ['--x'], { A: '1' }]]);
});

test('is not persistent and never reports survivors', async () => {
  const { backend } = harness();
  assert.equal(backend.kind, 'direct');
  assert.equal(backend.isPersistent(), false);
  assert.deepEqual([...(await backend.listSurvivors())], []);
  assert.equal(backend.isSurvivorDead('s1'), true);
});

test('detach kills the agent — a direct agent cannot outlive its client', () => {
  const { backend, ptys } = harness();
  const p = backend.spawn(opts('s1'));
  backend.detach(p);
  assert.equal(ptys[0].killedCount(), 1);
});

test('stopSession and stopAll kill the tracked agents', () => {
  const { backend, ptys } = harness();
  backend.spawn(opts('s1'));
  backend.spawn(opts('s2'));
  backend.stopSession('s1');
  assert.equal(ptys[0].killedCount(), 1);
  assert.equal(ptys[1].killedCount(), 0);
  backend.stopAll();
  assert.equal(ptys[1].killedCount(), 1);
});

test('a wheel report is a plain write to the agent', () => {
  const { backend, ptys } = harness();
  const p = backend.spawn(opts('s1'));
  backend.writeWheel('s1', p, '\x1b[<64;1;1M');
  assert.deepEqual(ptys[0].writes, ['\x1b[<64;1;1M']);
});

test('a naturally-exited agent is untracked and never signalled again', () => {
  const { backend, ptys } = harness();
  const p1 = backend.spawn(opts('s1'));
  backend.spawn(opts('s2'));
  ptys[0].fireExit(); // s1's agent exits on its own, e.g. the user typed `exit`

  backend.detach(p1);
  assert.equal(ptys[0].killedCount(), 0, 'detach must not kill an already-exited pty');

  backend.stopSession('s1');
  assert.equal(ptys[0].killedCount(), 0, 'stopSession must not kill an already-exited pty');

  backend.stopAll();
  assert.equal(ptys[0].killedCount(), 0, 'stopAll must not kill an already-exited pty');
  assert.equal(ptys[1].killedCount(), 1, 'stopAll still kills the still-running s2');
});

test('an InertPty accepts every call and never emits', () => {
  const p = new InertPty(80, 24);
  let events = 0;
  p.onData(() => { events++; });
  p.onExit(() => { events++; });
  assert.doesNotThrow(() => { p.write('x'); p.resize(100, 30); p.kill(); p.pause(); p.resume(); p.clear(); });
  assert.equal(events, 0);
  assert.equal(p.cols, 100);
  assert.equal(p.rows, 30);
});
