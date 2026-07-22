import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ClaudeHooksAdapter,
  extractSettingsFlag,
  mergeClaudeSettings,
} from './ClaudeHooksAdapter.js';
import type { SignalInjectionContext } from './types.js';

const ctx = (userFlags: string[]): SignalInjectionContext => ({
  sessionId: 'sess-1',
  signalBinPath: '/opt/argus/bin/argus-signal',
  signalDir: '/home/u/.argus/signals',
  userFlags,
});

test('extractSettingsFlag handles both --settings <v> and --settings=<v>', () => {
  assert.deepEqual(extractSettingsFlag(['--model', 'opus', '--settings', '/a.json']), {
    value: '/a.json',
    rest: ['--model', 'opus'],
  });
  assert.deepEqual(extractSettingsFlag(['--settings=/b.json', '--verbose']), {
    value: '/b.json',
    rest: ['--verbose'],
  });
  assert.deepEqual(extractSettingsFlag(['--model', 'opus']), { value: undefined, rest: ['--model', 'opus'] });
});

test('mergeClaudeSettings concatenates hook arrays and preserves other keys', () => {
  const user = {
    model: 'opus',
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'user-stop' }] }] },
  };
  const argus = { Stop: [{ hooks: [{ type: 'command' as const, command: 'argus-stop' }] }], PreToolUse: [{ hooks: [{ type: 'command' as const, command: 'argus-pre' }] }] };
  const merged = mergeClaudeSettings(user, argus);
  assert.equal(merged.model, 'opus', 'non-hook keys preserved');
  assert.equal(merged.hooks!.Stop.length, 2, 'user + argus Stop hooks concatenated');
  assert.equal(merged.hooks!.Stop[0]!.hooks[0]!.command, 'user-stop', 'user hook first');
  assert.equal(merged.hooks!.Stop[1]!.hooks[0]!.command, 'argus-stop', 'argus hook appended');
  assert.equal(merged.hooks!.PreToolUse.length, 1, 'argus-only event added');
});

test('inject (no user --settings): writes the Argus settings file + adds the flag', () => {
  const inj = new ClaudeHooksAdapter().inject(ctx(['--model', 'opus']));
  assert.deepEqual(inj.flags, ['--model', 'opus', '--settings', '/home/u/.argus/signals/sess-1.json']);
  assert.equal(inj.files.length, 1);
  assert.equal(inj.files[0]!.path, '/home/u/.argus/signals/sess-1.json');
  const content = JSON.parse(inj.files[0]!.content);
  assert.ok(content.hooks.Stop && content.hooks.UserPromptSubmit && content.hooks.PreToolUse && content.hooks.Notification);
  assert.match(content.hooks.Stop[0].hooks[0].command, /argus-signal" --session sess-1 --state idle$/);
  assert.match(content.hooks.Notification[0].hooks[0].command, /--state waiting --prompt-from-stdin$/);
});

test('inject (user --settings PATH): deep-merges, collapses to one flag, strips user flag', () => {
  const userSettings = JSON.stringify({
    permissions: { allow: ['Bash'] },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'my-stop' }] }] },
  });
  const adapter = new ClaudeHooksAdapter(() => userSettings); // mock read
  const inj = adapter.inject(ctx(['--settings', '/user/my.json', '--verbose']));

  // single merged --settings pointing at the Argus file; user flag removed
  assert.deepEqual(inj.flags, ['--verbose', '--settings', '/home/u/.argus/signals/sess-1.json']);
  const content = JSON.parse(inj.files[0]!.content);
  assert.deepEqual(content.permissions, { allow: ['Bash'] }, 'user non-hook keys preserved');
  assert.equal(content.hooks.Stop.length, 2, 'user + argus Stop hooks merged');
  assert.equal(content.hooks.Stop[0].hooks[0].command, 'my-stop', 'user hook kept first');
});

test('inject (user --settings=INLINE json): parses inline and merges', () => {
  const inline = '{"hooks":{"UserPromptSubmit":[{"hooks":[{"type":"command","command":"u"}]}]}}';
  const inj = new ClaudeHooksAdapter().inject(ctx([`--settings=${inline}`]));
  const content = JSON.parse(inj.files[0]!.content);
  assert.equal(content.hooks.UserPromptSubmit.length, 2, 'inline user hook + argus hook');
});

test('inject falls back to heuristics (no clobber) when user --settings is unreadable', () => {
  const adapter = new ClaudeHooksAdapter(() => {
    throw new Error('ENOENT');
  });
  const inj = adapter.inject(ctx(['--settings', '/missing.json', '--model', 'x']));
  assert.deepEqual(inj.flags, ['--settings', '/missing.json', '--model', 'x'], 'user flags untouched');
  assert.equal(inj.files.length, 0, 'nothing injected — never clobbers');
});

test('coverage is full (running/waiting/idle)', () => {
  assert.deepEqual([...new ClaudeHooksAdapter().coverage], ['running', 'waiting', 'idle']);
});
