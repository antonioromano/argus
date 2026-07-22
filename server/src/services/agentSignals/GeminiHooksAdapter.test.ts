import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiHooksAdapter } from './GeminiHooksAdapter.js';
import type { SignalInjectionContext } from './types.js';

const ctx = (userFlags: string[]): SignalInjectionContext => ({
  sessionId: 'sess-1',
  signalBinPath: '/opt/argus/bin/argus-signal',
  signalDir: '/home/u/.argus/signals',
  userFlags,
});

test('inject: env-based (GEMINI_CLI_SYSTEM_SETTINGS_PATH), flags untouched', () => {
  const inj = new GeminiHooksAdapter().inject(ctx(['--model', 'flash']));
  assert.deepEqual(inj.flags, ['--model', 'flash'], 'no flag added — injection is via env');
  assert.equal(inj.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH, '/home/u/.argus/signals/gemini-sess-1.json');
  assert.equal(inj.files.length, 1);
  assert.equal(inj.files[0]!.path, '/home/u/.argus/signals/gemini-sess-1.json');
});

test('inject: settings file has hooksConfig.enabled + the four event hooks', () => {
  const inj = new GeminiHooksAdapter().inject(ctx([]));
  const content = JSON.parse(inj.files[0]!.content);
  assert.equal(content.hooksConfig.enabled, true, 'must enable hooks or Gemini ignores them');
  assert.match(content.hooks.BeforeAgent[0].command, /--state running$/);
  assert.match(content.hooks.BeforeTool[0].command, /--state running$/);
  assert.match(content.hooks.AfterAgent[0].command, /--state idle$/);
  assert.match(content.hooks.Notification[0].command, /--state waiting --prompt-from-stdin$/);
  assert.match(content.hooks.AfterAgent[0].command, /--session sess-1 /);
});

test('coverage is full (running/waiting/idle)', () => {
  assert.deepEqual([...new GeminiHooksAdapter().coverage], ['running', 'waiting', 'idle']);
});
