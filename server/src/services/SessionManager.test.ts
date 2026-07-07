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
