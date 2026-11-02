import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { INITIAL_PROMPT_MAX, SessionManager } from './SessionManager.js';

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

test('prompt is the first argv entry, before user flags and signal injection', async () => {
  const { sm, spawns } = harness();
  await create(sm, ['--model=opus'], { initialPrompt: 'settings=/x notify=x' });
  const flags: string[] = spawns[0].flags;
  assert.equal(flags[0], 'settings=/x notify=x');
  const modelIdx = flags.indexOf('--model=opus');
  const settingsIdx = flags.indexOf('--settings');
  assert.ok(modelIdx > 0, 'user flags follow the prompt');
  assert.ok(settingsIdx > modelIdx, 'injected --settings still follows user flags');
  assert.ok(!flags.includes('/x'), 'prompt never parsed as a --settings value');
});

test('a bare user flag cannot capture the prompt as its value', async () => {
  const { sm, spawns } = harness();
  await create(sm, ['--add-dir'], { initialPrompt: 'hello' });
  const flags: string[] = spawns[0].flags;
  assert.equal(flags[0], 'hello');
  assert.ok(flags.indexOf('--add-dir') > 0, '--add-dir comes after the prompt');
});

test('prompt text that looks like injection flags is not parsed by the adapter', async () => {
  const { sm, spawns } = harness();
  await create(sm, [], { initialPrompt: 'use --settings=/tmp/evil.json please' });
  const flags: string[] = spawns[0].flags;
  assert.equal(flags[0], 'use --settings=/tmp/evil.json please');
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
  // Nor does Chat show it again (F15).
  assert.equal(sm.getSessionInfo(s.id)?.initialPrompt, undefined);
});

test('SessionInfo carries the launch prompt for Chat, clipped (F15)', async () => {
  const { sm } = harness();
  const s = await create(sm, [], { initialPrompt: 'fix the bug' });
  assert.deepEqual(s.initialPrompt, { text: 'fix the bug' });
  assert.deepEqual(sm.getSessionInfo(s.id)?.initialPrompt, { text: 'fix the bug' });
  const long = 'x'.repeat(INITIAL_PROMPT_MAX + 50);
  const big = await create(sm, [], { initialPrompt: long });
  assert.deepEqual(big.initialPrompt, { text: long.slice(0, INITIAL_PROMPT_MAX), clipped: true });
  // An emoji across the cut is dropped whole, never split into a lone surrogate.
  const emoji = await create(sm, [], { initialPrompt: 'x'.repeat(INITIAL_PROMPT_MAX - 1) + '😀 tail' });
  assert.equal(emoji.initialPrompt?.text, 'x'.repeat(INITIAL_PROMPT_MAX - 1));
  const none = await create(sm, [], {});
  assert.equal(none.initialPrompt, undefined);
});

test('restore does not replay the prompt and keeps launcherId', async () => {
  const { sm, spawns } = harness();
  const s = await create(sm, [], { initialPrompt: 'hello', launcherId: 'l1' });
  (sm as any).sessions.clear();
  await sm.restoreSessions();
  const last = spawns.at(-1);
  assert.ok(!last.flags.includes('hello'));
  assert.equal(sm.getSessionInfo(s.id)?.initialPrompt, undefined);
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

/** A heuristic settle to idle, with no done promotion (and so no grace timer). */
function settle(sm: SessionManager, id: string) {
  (sm as any).sessions.get(id).hasUserInputSinceIdle = false;
  (sm as any).applyDetectedStatus(id, 'idle');
}

/** Captures every session:status payload the manager broadcasts. */
function capture(sm: SessionManager): any[] {
  const out: any[] = [];
  (sm as any).io = { emit: (ev: string, p: any) => { if (ev === 'session:status') out.push(p); }, to: () => ({ emit() {} }) };
  return out;
}

test('the launch prompt and starting last until the first turn ends, then clear for every window (F15b)', async () => {
  const { sm } = harness();
  const s = await create(sm, [], { initialPrompt: 'fix the bug' });
  assert.equal(s.starting, true);
  const sent = capture(sm);
  // The folder-trust dialog (waiting) and a heuristic running keep it: the prompt is not read yet.
  sm.applyNativeSignal(s.id, { state: 'waiting', promptText: 'Do you trust the files in this folder?' });
  sm.applyNativeSignal(s.id, { state: 'running' });
  assert.equal(sent.at(-1).starting, true);
  assert.deepEqual(sent.at(-1).initialPrompt, { text: 'fix the bug' });
  assert.equal(sm.getSessionInfo(s.id)?.starting, true);
  // The first turn ends (Stop): the transcript has the prompt by now.
  sm.applyNativeSignal(s.id, { state: 'idle' });
  assert.equal(sent.at(-1).status, 'done');
  assert.equal(sent.at(-1).starting, undefined);
  assert.equal(sent.at(-1).initialPrompt, undefined);
  assert.equal(sm.getSessionInfo(s.id)?.starting, undefined);
  assert.equal(sm.getSessionInfo(s.id)?.initialPrompt, undefined);
  // Later turns (and a /clear) never bring it back.
  sm.applyNativeSignal(s.id, { state: 'running' });
  assert.equal(sent.at(-1).initialPrompt, undefined);
});

test('with no launch prompt, raw input (the trust-dialog Enter) is no first prompt; a Chat send is (F15b)', async () => {
  const { sm } = harness();
  const s = await create(sm, [], {});
  const sent = capture(sm);
  // The folder-trust dialog, answered with Enter in the terminal: no prompt yet.
  (sm as any).applyDetectedStatus(s.id, 'waiting');
  sm.writeToSession(s.id, '\r');
  (sm as any).applyDetectedStatus(s.id, 'running');
  // Claude settles at its welcome screen.
  sm.applyNativeSignal(s.id, { state: 'idle' });
  assert.equal(sent.at(-1).starting, true);
  // The first message, sent from an empty Chat (not awaited: it waits for screen settles).
  void sm.submitChatInput(s.id, 'hello', () => {});
  sm.writeToSession(s.id, 'hello\r'); // what the input queue then writes
  (sm as any).applyDetectedStatus(s.id, 'running');
  assert.equal(sent.at(-1).starting, true);
  sm.applyNativeSignal(s.id, { state: 'idle' });
  assert.equal(sent.at(-1).starting, undefined);
});

test('a prompt submitted in the terminal counts through the native running signal (F15b)', async () => {
  const { sm } = harness();
  const s = await create(sm, [], {});
  const sent = capture(sm);
  sm.writeToSession(s.id, 'hello\r');
  sm.applyNativeSignal(s.id, { state: 'running' }); // UserPromptSubmit
  assert.equal(sent.at(-1).starting, true);
  sm.applyNativeSignal(s.id, { state: 'idle' });
  assert.equal(sent.at(-1).starting, undefined);
});

test('with a launch prompt, a heuristic settle before any hook does not end startup (F15b)', async () => {
  const { sm } = harness();
  const s = await create(sm, [], { initialPrompt: 'fix it' });
  const sent = capture(sm);
  // Claude paints, then loads MCP servers before reading the prompt: the screen settles.
  settle(sm, s.id);
  assert.equal(sent.at(-1).status, 'idle');
  assert.equal(sent.at(-1).starting, true);
  assert.deepEqual(sent.at(-1).initialPrompt, { text: 'fix it' });
  // Then the prompt is submitted and its turn ends.
  sm.applyNativeSignal(s.id, { state: 'running' });
  sm.applyNativeSignal(s.id, { state: 'idle' });
  assert.equal(sent.at(-1).starting, undefined);
  assert.equal(sent.at(-1).initialPrompt, undefined);
});

test('with a launch prompt and no hooks, the heuristic ends startup after the fallback wait (F15b)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sm } = harness();
  const s = await create(sm, [], { initialPrompt: 'fix it' });
  const sent = capture(sm);
  const subscribed: string[] = [];
  sm.onStatus((_id, st) => subscribed.push(st));
  settle(sm, s.id); // the turn ended; no hook ever came
  assert.equal(sent.at(-1).starting, true);
  t.mock.timers.tick(29_000);
  assert.equal(sm.getSessionInfo(s.id)?.starting, true);
  t.mock.timers.tick(1_000);
  assert.equal(sm.getSessionInfo(s.id)?.starting, undefined);
  assert.equal(sm.getSessionInfo(s.id)?.initialPrompt, undefined);
  assert.equal(sent.at(-1).status, 'idle');
  assert.equal(sent.at(-1).starting, undefined);
  // Announced to sockets only: the status did not change, so no repeat for in-process subscribers.
  assert.deepEqual(subscribed, ['idle']);
});

test('an exit keeps the launch prompt; a restart starts over without it (F15b)', async () => {
  const { sm } = harness();
  const s = await create(sm, [], { initialPrompt: 'hello' });
  (sm as any).sessions.get(s.id).status = 'exited';
  assert.deepEqual(sm.getSessionInfo(s.id)?.initialPrompt, { text: 'hello' });
  const sent = capture(sm);
  await sm.restartSession(s.id);
  assert.equal(sent.at(-1).status, 'running');
  assert.equal(sent.at(-1).starting, true);
  assert.equal(sent.at(-1).initialPrompt, undefined);
});

test('a restored session is not starting (F15b)', async () => {
  const { sm } = harness();
  const s = await create(sm, [], { initialPrompt: 'hello' });
  (sm as any).sessions.clear();
  await sm.restoreSessions();
  assert.equal(sm.getSessionInfo(s.id)?.starting, undefined);
});

test('only Claude sessions track startup (F15b)', async () => {
  const { sm } = harness();
  (sm as any).configStore = { load: async () => ({ defaultAgent: 'claude', customAgents: [{ id: 'x', name: 'X', command: 'x', builtin: false }], agentFlags: {} }) };
  const s = await sm.createSession(os.tmpdir(), 'n', 'x', [], undefined, undefined, undefined, undefined, false, undefined, 'persistent', false, {});
  assert.equal(s.starting, undefined);
});
