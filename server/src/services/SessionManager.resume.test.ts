import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import { RawTail } from './RawTail.js';
import { SessionManager } from './SessionManager.js';

process.env.ARGUS_PTY_BACKEND = 'tmux'; // pin backend so a built argusd binary doesn't flip the default

const fakeConfig = {
  load: async () => ({ defaultAgent: 'claude', customAgents: [], agentFlags: {} }),
  save: async () => {},
} as any;

const ID = '0b0e7a3c-1f2d-4e5f-8a9b-0c1d2e3f4a5b';

function fakePty() {
  return {
    onData: () => ({ dispose: () => {} }),
    onExit: () => ({ dispose: () => {} }),
    write: () => {},
    resize: () => {},
    kill: () => {},
  } as any;
}

function fixture(over: Record<string, unknown> = {}, signals = false) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'argus-resume-'));
  const sm = new SessionManager(dataDir, fakeConfig);
  if (signals) sm.setSignalConfig('secret', '/opt/argus/bin/argus-signal');
  const spawns: any[] = [];
  const stops: string[] = [];
  (sm as any).backend = {
    kind: 'daemon' as const,
    isPersistent: () => true,
    spawn: (opts: any) => { spawns.push(opts); return fakePty(); },
    seedMirror: () => {},
    writeWheel: () => {},
    detach: () => {},
    stopSession: (id: string) => { stops.push(id); },
    stopAll: () => {},
    listSurvivors: async () => new Set<string>(),
    isSurvivorDead: () => false,
    reapOrphans: async () => {},
  };
  (sm as any).io = { to: () => ({ emit: () => {} }), emit: () => {} };
  (sm as any).companionTerminals = { kill: () => {} };
  (sm as any).persistSessions = async () => {};
  const session: any = {
    id: 's1',
    name: 'resume',
    folderPath: os.tmpdir(),
    agentType: 'claude',
    flags: ['--model', 'opus', '--continue'],
    status: 'exited',
    createdAt: new Date().toISOString(),
    pty: fakePty(),
    stateDetector: { destroy: () => {} },
    mirror: { dispose: () => {} },
    rawTail: new RawTail(64),
    persistent: true,
    hasUserInputSinceIdle: false,
    claudeSessionId: ID,
    ...over,
  };
  (sm as any).sessions.set('s1', session);
  return { sm, session, spawns, stops };
}

test('resume spawns claude --resume <id> ahead of the user flags, minus --continue', async () => {
  const { sm, spawns, session } = fixture();
  await sm.restartSession('s1', { resume: true });
  assert.equal(spawns.length, 1);
  assert.deepEqual(spawns[0].flags, ['--resume', ID, '--model', 'opus']);
  assert.deepEqual(session.flags, ['--model', 'opus', '--continue'], 'stored flags untouched');
});

test('resume keeps the Argus hooks injected after the resume flags', async () => {
  const { sm, spawns } = fixture({}, true);
  await sm.restartSession('s1', { resume: true });
  const flags: string[] = spawns[0].flags;
  assert.deepEqual(flags.slice(0, 2), ['--resume', ID]);
  assert.equal(flags[flags.length - 2], '--settings');
});

test('a plain restart is still a fresh start', async () => {
  const { sm, spawns } = fixture();
  await sm.restartSession('s1');
  assert.deepEqual(spawns[0].flags, ['--model', 'opus', '--continue']);
});

test('resume is refused, with nothing torn down, when there is no valid conversation', async () => {
  for (const over of [{ claudeSessionId: undefined }, { agentType: 'gemini' }, { claudeSessionId: '--help' }]) {
    const { sm, spawns, stops } = fixture(over);
    await assert.rejects(sm.restartSession('s1', { resume: true }));
    assert.equal(spawns.length, 0);
    assert.equal(stops.length, 0, 'agent left untouched');
  }
});
