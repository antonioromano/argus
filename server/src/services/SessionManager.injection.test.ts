import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { SessionManager } from './SessionManager.js';
import { AgentRegistry } from './AgentRegistry.js';

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

// The acceptance side of the same guard is asserted at the AgentRegistry unit
// rather than through createSession: the latter would proceed past the guard to
// spawn a real `claude` pty, which never resolves and hangs the test runner.
test('agent guard accepts a registered builtin and rejects a poisoned id', () => {
  const registry = new AgentRegistry();
  assert.equal(registry.isRegistered('claude', []), true);
  assert.equal(registry.isRegistered('claude; rm -rf ~', []), false);
});
