import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { SessionManager } from './SessionManager.js';

const fakeConfig = {
  load: async () => ({ defaultAgent: 'claude', customAgents: [], agentFlags: {} }),
  save: async () => {},
} as any;

function withFakeExitedSession(sm: SessionManager, id: string) {
  (sm as any).sessions.set(id, {
    id,
    name: 'test',
    folderPath: os.tmpdir(),
    agentType: 'claude',
    flags: [],
    status: 'exited',
    createdAt: new Date().toISOString(),
    pty: {},
    stateDetector: { resize: () => {} },
    outputBuffer: '',
    persistent: false,
    hasUserInputSinceIdle: false,
  });
}

test('writeToSession no-ops on an already-exited session instead of writing to a dead pty', () => {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  withFakeExitedSession(sm, 'sess-1');
  let writeCalled = false;
  (sm as any).ptyManager.write = () => { writeCalled = true; };

  assert.doesNotThrow(() => sm.writeToSession('sess-1', 'echo hi\n'));
  assert.equal(writeCalled, false);
});

test('writeToSession still throws for a genuinely unknown session id', () => {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  assert.throws(() => sm.writeToSession('does-not-exist', 'x'), /not found/);
});

function withFakeNonTmuxSession(sm: SessionManager, id: string, outputBuffer: string) {
  (sm as any).sessions.set(id, {
    id,
    name: 'test',
    folderPath: os.tmpdir(),
    agentType: 'claude',
    flags: [],
    status: 'running',
    createdAt: new Date().toISOString(),
    pty: {},
    stateDetector: { resize: () => {} },
    outputBuffer,
    persistent: false,
    hasUserInputSinceIdle: false,
  });
}

test('getReplaySnapshot reuses a cached frame within the TTL instead of re-capturing', () => {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  withFakeNonTmuxSession(sm, 'sess-2', 'first-snapshot');
  assert.equal(sm.getReplaySnapshot('sess-2')?.data, 'first-snapshot');

  (sm as any).sessions.get('sess-2').outputBuffer = 'second-snapshot';
  assert.equal(sm.getReplaySnapshot('sess-2')?.data, 'first-snapshot', 'expected cached frame, not a fresh capture');
});

test('getReplaySnapshot captures fresh once the cache entry is stale', () => {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  withFakeNonTmuxSession(sm, 'sess-3', 'first-snapshot');
  sm.getReplaySnapshot('sess-3');

  (sm as any).replaySnapshotCache.get('sess-3').capturedAt = Date.now() - 1000;
  (sm as any).sessions.get('sess-3').outputBuffer = 'second-snapshot';
  assert.equal(sm.getReplaySnapshot('sess-3')?.data, 'second-snapshot');
});
