import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { SessionManager } from './SessionManager.js';

process.env.ARGUS_PTY_BACKEND = 'tmux'; // pin backend so a built argusd binary doesn't flip the default

const fakeConfig = {
  load: async () => ({ defaultAgent: 'claude', customAgents: [], agentFlags: {} }),
  save: async () => {},
} as any;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A pty stub that records its handlers so a test can fire them like the backend would. */
function fakePty(label: string, log: string[]) {
  const handlers: { data: Array<(d: string) => void>; exit: Array<(e: { exitCode: number }) => void> } = { data: [], exit: [] };
  return {
    label,
    handlers,
    onData: (cb: (d: string) => void) => { handlers.data.push(cb); return { dispose: () => {} }; },
    onExit: (cb: (e: { exitCode: number }) => void) => { handlers.exit.push(cb); return { dispose: () => {} }; },
    write: () => {},
    resize: () => {},
    kill: () => { log.push(`kill:${label}`); },
  } as any;
}

/**
 * A daemon-shaped backend: stopping a session is asynchronous (the agent dies,
 * then its exit is reported), and the id is only free once that completes.
 */
function fixture() {
  const log: string[] = [];
  const emits: Array<{ event: string; payload: any }> = [];
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  const old = fakePty('old', log);
  const fresh = fakePty('fresh', log);

  const backend = {
    kind: 'daemon' as const,
    isPersistent: () => true,
    spawn: () => { log.push('spawn'); return fresh; },
    seedMirror: () => {},
    writeWheel: () => {},
    detach: () => { log.push('detach'); },
    stopSession: (id: string) => { log.push(`stopSession:${id}`); },
    stopSessionAndWait: async (id: string) => {
      log.push(`stopWait:start:${id}`);
      await sleep(20);
      log.push(`stopWait:done:${id}`);
    },
    stopAll: () => {},
    listSurvivors: async () => new Set<string>(),
    isSurvivorDead: () => false,
    reapOrphans: async () => {},
  };
  (sm as any).backend = backend;
  (sm as any).io = {
    to: () => ({ emit: (event: string, payload: any) => emits.push({ event, payload }) }),
    emit: (event: string, payload: any) => emits.push({ event, payload }),
  };
  (sm as any).companionTerminals = { kill: () => {} };
  (sm as any).persistSessions = async () => {};

  const session: any = {
    id: 's1',
    name: 'restart',
    folderPath: os.tmpdir(),
    agentType: 'claude',
    flags: [],
    status: 'running',
    createdAt: new Date().toISOString(),
    pty: old,
    stateDetector: { destroy: () => {}, feed: () => {}, setOnPromptUpdate: () => {}, setExited: () => {} },
    mirror: { dispose: () => {}, feed: async () => {} },
    outputBuffer: 'stale',
    persistent: true,
    hasUserInputSinceIdle: false,
    cols: 100,
    rows: 40,
  };
  (sm as any).sessions.set('s1', session);

  return { sm, session, backend, log, emits, old, fresh };
}

// The daemon reports the OLD agent's exit a few ms after the kill. If the fresh
// agent was already spawned on the same id by then, that stale exit landed on the
// new pty and marked the just-restarted shell as exited — the terminal looked
// hung until the user restarted a second time. Restart must therefore wait for
// the backend to release the id before spawning.
test('restartSession waits for the old agent to be gone before spawning the new one', async () => {
  const { sm, log } = fixture();

  await sm.restartSession('s1');

  const stopDone = log.indexOf('stopWait:done:s1');
  const spawned = log.indexOf('spawn');
  assert.ok(stopDone >= 0, `stopSessionAndWait was not used: ${log.join(', ')}`);
  assert.ok(spawned > stopDone, `spawn ran before the old agent was released: ${log.join(', ')}`);
});

test('restartSession leaves the session running on a fresh pty', async () => {
  const { sm, session, fresh } = fixture();

  const info = await sm.restartSession('s1');

  assert.equal(session.pty, fresh);
  assert.equal(info.status, 'running');
  assert.equal(session.outputBuffer, '');
});
