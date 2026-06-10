import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { SessionManager } from './SessionManager.js';

// A poisoned agentType must be rejected before any pty spawn — otherwise it is
// interpolated raw into `sh -l -c 'exec <agentType>'` (command injection).
test('createSession rejects an unregistered agentType', async () => {
  const fakeConfig = {
    load: async () => ({ defaultAgent: 'claude', customAgents: [], agentFlags: {} }),
    save: async () => {},
  } as any;
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  await assert.rejects(
    () => sm.createSession(os.tmpdir(), 'x', 'claude; rm -rf ~'),
    /Unknown agent type/,
  );
});

test('createSession accepts a registered builtin agentType', async () => {
  const fakeConfig = {
    load: async () => ({ defaultAgent: 'claude', customAgents: [], agentFlags: {} }),
    save: async () => {},
  } as any;
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  // 'claude' is a registered builtin; createSession should pass the agent guard.
  // It may still fail later (spawning a real pty), so we only assert it does NOT
  // reject with the agent-guard error.
  await sm.createSession(os.tmpdir(), 'ok', 'claude').catch((err: Error) => {
    assert.doesNotMatch(err.message, /Unknown agent type/);
  });
});
