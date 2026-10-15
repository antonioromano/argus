import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { SessionManager } from './SessionManager.js';

process.env.ARGUS_PTY_BACKEND = 'tmux';

const cfg = { load: async () => ({ defaultAgent: 'claude', customAgents: [], agentFlags: {} }), save: async () => {} } as any;

// Both spawn sites (create/restore and restart) build the agent env here, so
// pinning it covers the Claude renderer choice reaching the pty on either path.
test('a Claude spawn carries the renderer env alongside the signal-injection env', () => {
  const sm = new SessionManager(os.tmpdir(), cfg);
  const env = (sm as any).agentSpawnEnv('claude', 'claude', { claudeRenderer: 'fullscreen' }, { env: { ARGUS_SIGNAL_URL: 'u' } });
  assert.deepEqual(env, { ARGUS_SIGNAL_URL: 'u', CLAUDE_CODE_NO_FLICKER: '1' });
});

test('classic and inherit reach the spawn env as chosen', () => {
  const sm = new SessionManager(os.tmpdir(), cfg);
  assert.deepEqual((sm as any).agentSpawnEnv('claude', 'claude', { claudeRenderer: 'classic' }, null), { CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: '1' });
  assert.deepEqual((sm as any).agentSpawnEnv('claude', 'claude', { claudeRenderer: 'inherit' }, null), {});
});

test('non-Claude agents get no renderer env', () => {
  const sm = new SessionManager(os.tmpdir(), cfg);
  assert.deepEqual((sm as any).agentSpawnEnv('gemini', 'gemini', { claudeRenderer: 'fullscreen' }, null), {});
});
