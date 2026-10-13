import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubParentAgentEnv } from './scrubParentAgentEnv.js';

test('drops a parent Claude session markers, keeps user settings', () => {
  const env: NodeJS.ProcessEnv = {
    CLAUDECODE: '1',
    CLAUDE_CODE_CHILD_SESSION: '1',
    CLAUDE_CODE_SESSION_ID: 'abc',
    CLAUDE_CODE_MESSAGING_TOKEN: 'secret',
    CLAUDE_PID: '42',
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    PATH: '/usr/bin',
  };
  const removed = scrubParentAgentEnv(env);
  assert.deepEqual(env, { CLAUDE_CODE_ENABLE_TELEMETRY: '1', PATH: '/usr/bin' });
  assert.equal(removed.length, 5);
});

test('is a no-op on a clean env', () => {
  const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
  assert.deepEqual(scrubParentAgentEnv(env), []);
  assert.deepEqual(env, { PATH: '/usr/bin' });
});
