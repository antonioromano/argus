import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { ChatTail, MAX_CHAT_MESSAGES, MAX_CHAT_TEXT, cleanUserText, echoCommandOf, parseChatEntry, parseChatLine, parseSkillListing } from './ChatTail.js';

const user = (uuid: string, content: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'user', uuid, timestamp: '2026-10-23T16:00:00.000Z', message: { role: 'user', content }, ...extra });
const assistant = (uuid: string, content: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'assistant', uuid, message: { id: 'msg_1', role: 'assistant', content }, ...extra });

function tmpFile(): string {
  return path.join(mkdtempSync(path.join(os.tmpdir(), 'argus-chat-')), 'abc.jsonl');
}

test('parses user and assistant text with timestamps', () => {
  assert.deepEqual(parseChatEntry(user('u1', 'hello')), {
    id: 'u1',
    role: 'user',
    blocks: [{ kind: 'text', text: 'hello' }],
    ts: Date.parse('2026-10-23T16:00:00.000Z'),
  });
  assert.deepEqual(parseChatEntry(assistant('a1', [{ type: 'text', text: '# Hi\n\n```ts\nx\n```' }]))?.blocks, [
    { kind: 'text', text: '# Hi\n\n```ts\nx\n```' },
  ]);
});

test('tool calls become pending steps; thinking and tool results make no message', () => {
  assert.deepEqual(parseChatEntry(assistant('a1', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]))?.blocks, [
    { kind: 'tool', id: 't1', name: 'Bash', label: 'ls', status: 'pending', detail: { command: 'ls' } },
  ]);
  assert.equal(parseChatEntry(assistant('a2', [{ type: 'thinking', thinking: '' }])), undefined);
  assert.equal(parseChatEntry(user('u1', [{ type: 'tool_result', tool_use_id: 't1', content: 'out' }])), undefined);
  assert.deepEqual(parseChatLine(user('u1', [{ type: 'tool_result', tool_use_id: 't1', content: 'out' }]))?.toolResults, [
    { id: 't1', status: 'ok', output: 'out' },
  ]);
});

test('unknown block types are kept as unknown, never thrown', () => {
  assert.deepEqual(parseChatEntry(assistant('a1', [{ type: 'hologram' }, 42, null, { type: 'text', text: 'ok' }]))?.blocks, [
    { kind: 'unknown', type: 'hologram' },
    { kind: 'text', text: 'ok' },
  ]);
});

test('skips malformed, meta, sidechain and non-message entries', () => {
  assert.equal(parseChatEntry('{not json "user"'), undefined);
  assert.equal(parseChatEntry('"user"'), undefined);
  assert.equal(parseChatEntry(JSON.stringify({ type: 'attachment', uuid: 'x' })), undefined);
  assert.equal(parseChatEntry(user('u1', 'x', { isMeta: true })), undefined);
  assert.equal(parseChatEntry(assistant('a1', [{ type: 'text', text: 'x' }], { isSidechain: true })), undefined);
  assert.equal(parseChatEntry(JSON.stringify({ type: 'user', message: { content: 'no uuid' } })), undefined);
  assert.equal(parseChatEntry(JSON.stringify({ type: 'user', uuid: 'u', message: 'nope' })), undefined);
  assert.equal(parseChatEntry(user('u1', { weird: true })), undefined);
});

test('user text drops harness wrappers and shows commands as typed', () => {
  assert.equal(cleanUserText('<system-reminder>\nnoise\n</system-reminder>\nreal question'), 'real question');
  assert.equal(cleanUserText('<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>opus</command-args>'), '/model opus');
  assert.equal(cleanUserText('<bash-input>git status</bash-input>'), '! git status');
  assert.equal(cleanUserText('<local-command-stdout>done</local-command-stdout>'), '');
  assert.equal(parseChatEntry(user('u1', '<system-reminder>only</system-reminder>')), undefined);
});

test('very long text is clipped', () => {
  const m = parseChatEntry(assistant('a1', [{ type: 'text', text: 'x'.repeat(MAX_CHAT_TEXT + 10) }]));
  const block = m?.blocks[0];
  assert.ok(block?.kind === 'text' && block.text.length < MAX_CHAT_TEXT + 50 && block.text.endsWith('(truncated)'));
});

test('ChatTail: first drain is a reset with everything, then only new messages', async () => {
  const f = tmpFile();
  writeFileSync(f, user('u1', 'one') + '\n' + '{garbage\n' + assistant('a1', [{ type: 'text', text: 'two' }]) + '\n');
  const t = new ChatTail(f);
  await t.poll();
  let d = t.drain();
  assert.equal(d.reset, true);
  assert.deepEqual(d.messages.map((m) => m.id), ['u1', 'a1']);

  // A line flushed in two writes is read once, whole.
  const next = user('u2', 'three') + '\n';
  appendFileSync(f, next.slice(0, 10));
  await t.poll();
  assert.deepEqual(t.drain(), { reset: false, messages: [] });
  appendFileSync(f, next.slice(10));
  await t.poll();
  d = t.drain();
  assert.equal(d.reset, false);
  assert.deepEqual(d.messages.map((m) => m.id), ['u2']);
  rmSync(path.dirname(f), { recursive: true, force: true });
});

test('ChatTail: a rewritten file resets the list', async () => {
  const f = tmpFile();
  writeFileSync(f, user('u1', 'one') + '\n' + user('u2', 'two') + '\n');
  const t = new ChatTail(f);
  await t.poll();
  t.drain();
  writeFileSync(f, user('u9', 'fresh') + '\n');
  await t.poll();
  const d = t.drain();
  assert.equal(d.reset, true);
  assert.deepEqual(d.messages.map((m) => m.id), ['u9']);
  rmSync(path.dirname(f), { recursive: true, force: true });
});

test('ChatTail keeps only the newest messages', async () => {
  const f = tmpFile();
  let body = '';
  for (let i = 0; i < MAX_CHAT_MESSAGES + 5; i++) body += user(`u${i}`, `m${i}`) + '\n';
  writeFileSync(f, body);
  const t = new ChatTail(f);
  await t.poll();
  assert.equal(t.messages.length, MAX_CHAT_MESSAGES);
  assert.equal(t.messages[0].id, 'u5');
  rmSync(path.dirname(f), { recursive: true, force: true });
});

test('ChatTail reports the permission mode on a reset and when it changes', async () => {
  const f = tmpFile();
  // A tool-result entry is not a message but still carries the mode.
  writeFileSync(f, user('u1', 'one', { permissionMode: 'default' }) + '\n' + user('u2', [{ type: 'tool_result' }], { permissionMode: 'auto' }) + '\n');
  const t = new ChatTail(f);
  await t.poll();
  let d = t.drain();
  assert.equal(d.permissionMode, 'auto');
  assert.deepEqual(d.messages.map((m) => m.id), ['u1']);

  appendFileSync(f, user('u3', 'same mode', { permissionMode: 'auto' }) + '\n');
  await t.poll();
  d = t.drain();
  assert.equal(d.permissionMode, undefined, 'unchanged mode is not resent');

  appendFileSync(f, user('u4', [{ type: 'tool_result' }], { permissionMode: 'plan' }) + '\n');
  assert.equal(await t.poll(), true);
  d = t.drain();
  assert.deepEqual(d, { reset: false, messages: [], permissionMode: 'plan' });
  rmSync(path.dirname(f), { recursive: true, force: true });
});

test('sidechain entries do not change the permission mode', () => {
  assert.equal(parseChatLine(user('s1', 'x', { isSidechain: true, permissionMode: 'plan' })), undefined);
  assert.deepEqual(parseChatLine(user('u1', 'x', { isMeta: true, permissionMode: 'plan' })), { message: undefined, permissionMode: 'plan' });
});

test('ChatTail reports the model set with /model', async () => {
  const f = tmpFile();
  const reply = (uuid: string, label: string) =>
    user(uuid, `<local-command-stdout>Set model to \`${label}\` and saved as your default for new sessions</local-command-stdout>`);
  writeFileSync(f, reply('r1', 'Sonnet 5.5') + '\n');
  const t = new ChatTail(f);
  await t.poll();
  assert.equal(t.drain().modelSet, 'Sonnet 5.5');
  appendFileSync(f, reply('r2', 'Opus 5.5') + '\n');
  await t.poll();
  const d = t.drain();
  assert.equal(d.modelSet, 'Opus 5.5');
  assert.deepEqual(d.messages.map((m) => m.role), ['system'], 'the reply itself shows as command output');
  rmSync(path.dirname(f), { recursive: true, force: true });
});

// Slash commands (D1). The lines below are real Claude Code transcript lines
// (2.1.276–2.1.310), trimmed to the fields the parser reads.
const REAL = {
  caveat:
    '{"parentUuid":null,"isSidechain":false,"type":"user","message":{"role":"user","content":"<local-command-caveat>The command below was run directly in Claude Code, not sent to you as a request, and its output goes straight to the user. It\'s recorded here as context for later messages.</local-command-caveat>"},"isMeta":true,"uuid":"ba233ace-0a15-47e1-aaca-aaa4636a31c7","timestamp":"2026-10-23T21:39:59.245Z"}',
  model:
    '{"parentUuid":"ba233ace-0a15-47e1-aaca-aaa4636a31c7","isSidechain":false,"type":"user","message":{"role":"user","content":"<command-name>/model</command-name>\\n            <command-message>model</command-message>\\n            <command-args>claude-opus-5-5</command-args>"},"uuid":"76ef6a48-677c-4a88-833c-d26f553f82e8","timestamp":"2026-10-23T21:39:59.245Z"}',
  modelOut:
    '{"parentUuid":"76ef6a48-677c-4a88-833c-d26f553f82e8","isSidechain":false,"type":"user","message":{"role":"user","content":"<local-command-stdout>Set model to `Opus 5.5` and saved as your default for new sessions</local-command-stdout>"},"uuid":"35063265-ecb4-4b0a-9054-e03269406332","timestamp":"2026-10-23T21:39:59.245Z"}',
  clear:
    '{"parentUuid":null,"isSidechain":false,"type":"user","message":{"role":"user","content":"<command-name>/clear</command-name>\\n            <command-message>clear</command-message>\\n            <command-args></command-args>"},"uuid":"c1ea0000-0000-4000-8000-000000000001","timestamp":"2026-10-20T09:12:01.000Z"}',
  compact:
    '{"parentUuid":"p","isSidechain":false,"type":"user","message":{"role":"user","content":"<command-name>/compact</command-name>\\n            <command-message>compact</command-message>\\n            <command-args></command-args>"},"uuid":"c0a70000-0000-4000-8000-000000000002","timestamp":"2026-10-20T09:15:00.000Z"}',
  compactOut:
    '{"parentUuid":"c0a70000-0000-4000-8000-000000000002","isSidechain":false,"type":"user","message":{"role":"user","content":"<local-command-stdout>\\u001b[2mCompacted (ctrl+o to see full summary)\\u001b[22m</local-command-stdout>"},"uuid":"c0a70000-0000-4000-8000-000000000003","timestamp":"2026-10-20T09:15:30.000Z"}',
  compactSummary:
    '{"parentUuid":"c0a70000-0000-4000-8000-000000000003","isSidechain":false,"type":"user","message":{"role":"user","content":"This session is being continued from a previous conversation…"},"isCompactSummary":true,"isVisibleInTranscriptOnly":true,"uuid":"c0a70000-0000-4000-8000-000000000004","timestamp":"2026-10-20T09:15:30.000Z"}',
  // A custom command (a skill): tags in another order, then the skill body as a meta entry.
  custom:
    '{"parentUuid":"p","isSidechain":false,"type":"user","message":{"role":"user","content":"<command-message>pr-review</command-message>\\n<command-name>/pr-review</command-name>\\n<command-args>#64</command-args>"},"uuid":"5c111000-0000-4000-8000-000000000005","timestamp":"2026-10-21T10:00:00.000Z"}',
  customBody:
    '{"parentUuid":"5c111000-0000-4000-8000-000000000005","isSidechain":false,"type":"user","message":{"role":"user","content":[{"type":"text","text":"Base directory for this skill: /Users/x/.claude/skills/pr-review\\n\\n# PR review…"}]},"isMeta":true,"uuid":"5c111000-0000-4000-8000-000000000006","timestamp":"2026-10-21T10:00:00.000Z"}',
  noContent:
    '{"parentUuid":"p","isSidechain":false,"type":"user","message":{"role":"user","content":"<local-command-stdout>(no content)</local-command-stdout>"},"uuid":"0c000000-0000-4000-8000-000000000007","timestamp":"2026-10-21T10:00:00.000Z"}',
  // Newer versions: a dismissed picker is a `system` local_command pair.
  pickerSys:
    '{"parentUuid":"bebc8726-ccae-4099-99bc-2e5f9da0976e","isSidechain":false,"type":"system","subtype":"local_command","content":"<command-name>/model</command-name>\\n            <command-message>model</command-message>\\n            <command-args></command-args>","level":"info","timestamp":"2026-10-26T11:42:40.676Z","uuid":"835972bf-51a3-428a-bbd6-7dfb487a8cd9","isMeta":false}',
  pickerSysOut:
    '{"parentUuid":"835972bf-51a3-428a-bbd6-7dfb487a8cd9","isSidechain":false,"type":"system","subtype":"local_command","content":"<local-command-stdout>Kept model as `Opus 5.5`</local-command-stdout>","level":"info","timestamp":"2026-10-26T11:42:40.676Z","uuid":"ba642309-0e6d-4cce-a41c-9b7ca3faeef3","isMeta":false,"commandRun":{"command":"model","args":""}}',
  forkedOut:
    '{"parentUuid":"p","isSidechain":false,"type":"system","subtype":"local_command","content":"<local-command-stdout>Running in the background as @code-review</local-command-stdout>\\n<forked-skill-launch>{\\"agentId\\":\\"a1\\"}</forked-skill-launch>","level":"info","timestamp":"2026-10-24T08:00:00.000Z","uuid":"f0000000-0000-4000-8000-000000000008","isMeta":false}',
  unknown:
    '{"parentUuid":"p","isSidechain":false,"type":"system","subtype":"informational","content":"Unknown command: /foobarxyz","isMeta":false,"timestamp":"2026-10-26T11:42:47.388Z","uuid":"5c4aff60-7e72-4d02-b9db-ac01feacd0e4","level":"warning"}',
  turnDuration:
    '{"parentUuid":"p","isSidechain":false,"type":"system","subtype":"turn_duration","durationMs":1200,"timestamp":"2026-10-26T11:42:47.388Z","uuid":"d0000000-0000-4000-8000-000000000009","isMeta":false}',
};

test('slash commands from real transcripts become command messages', () => {
  assert.equal(parseChatEntry(REAL.caveat), undefined, 'the caveat is meta');
  assert.deepEqual(parseChatEntry(REAL.model), {
    id: '76ef6a48-677c-4a88-833c-d26f553f82e8',
    role: 'user',
    ts: Date.parse('2026-10-23T21:39:59.245Z'),
    blocks: [{ kind: 'command', name: '/model', args: 'claude-opus-5-5' }],
  });
  assert.deepEqual(parseChatEntry(REAL.clear)?.blocks, [{ kind: 'command', name: '/clear' }]);
  assert.deepEqual(parseChatEntry(REAL.compact)?.blocks, [{ kind: 'command', name: '/compact' }]);
  assert.deepEqual(parseChatEntry(REAL.custom)?.blocks, [{ kind: 'command', name: '/pr-review', args: '#64' }]);
  assert.equal(parseChatEntry(REAL.customBody), undefined, 'the skill body is meta');
  assert.deepEqual(parseChatEntry(user('b1', '<bash-input>git status</bash-input>'))?.blocks, [{ kind: 'command', name: '!', args: 'git status' }]);
});

test('local command output is a system message, ANSI and noise removed', () => {
  const out = parseChatLine(REAL.modelOut)!;
  assert.equal(out.modelSet, 'Opus 5.5');
  assert.equal(out.message?.role, 'system');
  assert.deepEqual(out.message?.blocks, [
    { kind: 'output', stream: 'stdout', text: 'Set model to `Opus 5.5` and saved as your default for new sessions' },
  ]);
  assert.deepEqual(parseChatEntry(REAL.compactOut)?.blocks, [
    { kind: 'output', stream: 'stdout', text: 'Compacted (ctrl+o to see full summary)' },
  ]);
  assert.equal(parseChatEntry(REAL.compactSummary), undefined);
  assert.equal(parseChatEntry(REAL.noContent), undefined, 'empty output is dropped');
  assert.deepEqual(parseChatEntry(user('e1', '<bash-stdout></bash-stdout><bash-stderr>boom</bash-stderr>'))?.blocks, [
    { kind: 'output', stream: 'stderr', text: 'boom' },
  ]);
  // A prompt that only quotes the tag stays the user's text.
  const quoted = parseChatEntry(user('q1', 'why is <local-command-stdout>x</local-command-stdout> hidden?'));
  assert.equal(quoted?.role, 'user');
  assert.deepEqual(quoted?.blocks, [{ kind: 'text', text: 'why is  hidden?' }]);
});

test('system local_command and informational entries (newer Claude Code)', () => {
  assert.deepEqual(parseChatEntry(REAL.pickerSys), {
    id: '835972bf-51a3-428a-bbd6-7dfb487a8cd9',
    role: 'user',
    ts: Date.parse('2026-10-26T11:42:40.676Z'),
    blocks: [{ kind: 'command', name: '/model' }],
  });
  const out = parseChatEntry(REAL.pickerSysOut);
  assert.equal(out?.role, 'system');
  assert.deepEqual(out?.blocks, [{ kind: 'output', stream: 'stdout', text: 'Kept model as `Opus 5.5`' }]);
  assert.deepEqual(parseChatEntry(REAL.forkedOut)?.blocks, [
    { kind: 'output', stream: 'stdout', text: 'Running in the background as @code-review' },
  ]);
  assert.deepEqual(parseChatEntry(REAL.unknown), {
    id: '5c4aff60-7e72-4d02-b9db-ac01feacd0e4',
    role: 'system',
    ts: Date.parse('2026-10-26T11:42:47.388Z'),
    blocks: [{ kind: 'notice', text: 'Unknown command: /foobarxyz' }],
  });
  assert.equal(parseChatLine(REAL.turnDuration), undefined, 'other system entries are not messages');
  assert.equal(parseChatLine(REAL.pickerSys.replace('"isSidechain":false', '"isSidechain":true')), undefined);
});

test('echoCommandOf: single-line slash commands only', () => {
  assert.deepEqual(echoCommandOf('  /model   opus '), { name: '/model', args: 'opus' });
  assert.deepEqual(echoCommandOf('/cost'), { name: '/cost' });
  assert.equal(echoCommandOf('hello /model'), undefined);
  assert.equal(echoCommandOf('/model\nsecond line'), undefined);
  assert.equal(echoCommandOf('/'), undefined);
  assert.equal(echoCommandOf('/usr/bin/env is a path'), undefined);
});

test('ChatTail echoes a sent command until the transcript records it', async () => {
  const f = tmpFile();
  writeFileSync(f, user('u1', 'hi') + '\n');
  const t = new ChatTail(f);
  await t.poll();
  t.drain();

  // Never recorded (/cost): the echo stays.
  assert.equal(t.echo('/cost', 1000), true);
  assert.equal(t.echo('plain prompt'), false);
  let d = t.drain();
  assert.deepEqual(d.messages, [{ id: 'echo-1', role: 'user', ts: 1000, echo: true, blocks: [{ kind: 'command', name: '/cost' }] }]);

  // Recorded later: the echo is dropped on the client, the real entry appended.
  t.echo('/model claude-opus-5-5', 2000);
  t.drain();
  appendFileSync(f, REAL.caveat + '\n' + REAL.model + '\n' + REAL.modelOut + '\n');
  await t.poll();
  d = t.drain();
  assert.deepEqual(d.removed, ['echo-2']);
  assert.deepEqual(d.messages.map((m) => m.id), ['76ef6a48-677c-4a88-833c-d26f553f82e8', '35063265-ecb4-4b0a-9054-e03269406332']);
  assert.deepEqual(t.messages.map((m) => m.id), ['u1', 'echo-1', '76ef6a48-677c-4a88-833c-d26f553f82e8', '35063265-ecb4-4b0a-9054-e03269406332']);

  // Recorded before the echo was ever drained: it is simply never sent.
  t.echo('/clear', 3000);
  appendFileSync(f, REAL.clear + '\n');
  await t.poll();
  d = t.drain();
  assert.equal(d.removed, undefined);
  assert.deepEqual(d.messages.map((m) => m.id), ['c1ea0000-0000-4000-8000-000000000001']);
  rmSync(path.dirname(f), { recursive: true, force: true });
});

test('ChatTail: a recorded command settles an echo of its prefix, and only one echo', async () => {
  const f = tmpFile();
  writeFileSync(f, '');
  const t = new ChatTail(f);
  await t.poll();
  t.drain();
  const recorded = Date.parse('2026-10-20T09:15:00.000Z');
  t.echo('/compa', recorded - 1000);
  t.echo('/compact', recorded - 500);
  t.drain();
  appendFileSync(f, REAL.compact + '\n');
  await t.poll();
  assert.deepEqual(t.drain().removed, ['echo-1'], 'the oldest matching echo');
  assert.deepEqual(t.messages.filter((m) => m.echo).map((m) => m.id), ['echo-2']);
  rmSync(path.dirname(f), { recursive: true, force: true });
});

test('ChatTail: a prefix only answers an echo right after it; aliases answer their canonical command', async () => {
  const f = tmpFile();
  writeFileSync(f, '');
  const t = new ChatTail(f);
  await t.poll();
  t.drain();
  const recorded = Date.parse('2026-10-20T09:15:00.000Z');
  t.echo('/co', recorded - 60_000); // a minute earlier: /compact is something else
  t.echo('/settings', recorded - 60_000);
  t.drain();
  const config = REAL.compact.replace(/compact/g, 'config');
  appendFileSync(f, REAL.compact + '\n' + config + '\n');
  await t.poll();
  assert.deepEqual(t.drain().removed, ['echo-2'], '/config settles the /settings echo');
  assert.deepEqual(t.messages.filter((m) => m.echo).map((m) => m.id), ['echo-1'], 'the stale /co echo stays');
  rmSync(path.dirname(f), { recursive: true, force: true });
});

// The skill listing Claude Code attaches to a conversation (2.1.310), trimmed.
const listing = (content: string, isInitial = true) =>
  JSON.stringify({
    parentUuid: 'p',
    isSidechain: false,
    type: 'attachment',
    attachment: { type: 'skill_listing', content, skillCount: 3, isInitial, names: [] },
    uuid: 'sk-1',
    timestamp: '2026-10-26T10:00:00.000Z',
  });

test('parseSkillListing reads `- name: description` rows', () => {
  const content =
    '- pr-review: Review a GitHub PR (by URL, number, or repo+number) for correctness bugs — output in italiano + GH-ready comments\n' +
    '- anthropic-skills:docx: Use this skill whenever the user wants Word documents\n' +
    'TRIGGER — a continuation line of the previous description\n' +
    '- init: \n' +
    `- long: ${'x'.repeat(400)}`;
  const out = parseSkillListing(content);
  assert.deepEqual(out.slice(0, 3), [
    { name: 'pr-review', description: 'Review a GitHub PR (by URL, number, or repo+number) for correctness bugs — output in italiano + GH-ready comments' },
    { name: 'anthropic-skills:docx', description: 'Use this skill whenever the user wants Word documents' },
    { name: 'init' },
  ]);
  assert.ok(out[3].description!.length <= 160 && out[3].description!.endsWith('…'));
});

test('ChatTail reports the skill listing on a reset and when it changes', async () => {
  const f = tmpFile();
  writeFileSync(f, user('u1', 'hi') + '\n' + listing('- pr-review: Review a PR\n- push-updates: Push') + '\n');
  const t = new ChatTail(f);
  await t.poll();
  let d = t.drain();
  assert.deepEqual(d.commands?.map((c) => c.name), ['pr-review', 'push-updates']);
  assert.deepEqual(d.messages.map((m) => m.id), ['u1'], 'the listing is not a message');

  appendFileSync(f, user('u2', 'more') + '\n');
  await t.poll();
  assert.equal(t.drain().commands, undefined, 'unchanged listing is not resent');

  // A later, non-initial listing adds to it.
  appendFileSync(f, listing('- deploy: Ship it\n- pr-review: Review a PR, v2', false) + '\n');
  await t.poll();
  d = t.drain();
  assert.deepEqual(d.commands?.map((c) => [c.name, c.description]), [
    ['push-updates', 'Push'],
    ['deploy', 'Ship it'],
    ['pr-review', 'Review a PR, v2'],
  ]);
  assert.equal(parseChatLine(listing('- x: y').replace('"isSidechain":false', '"isSidechain":true')), undefined);
  rmSync(path.dirname(f), { recursive: true, force: true });
});

test('a composer prompt with an image renders as typed: no paste wrapper, image marker or temp path (F2)', () => {
  // Real-shaped entry: Claude Code wraps the pasted text, leaves `[Image #N]`
  // and the temp path inline, and records the image as its own block.
  const tmp = '/var/folders/xh/qkxmvh7503l8l87ntff5p6fm0000gn/T/argus-chat-images/93bb08bb-19e9-4b37-a511-c4fd55ea5049.png';
  const entry = user('u1', [
    { type: 'text', text: `[Image #14]\n\n<pasted_content id="910a">\n${tmp} - first point\n- second point\n</pasted_content id="910a">\n` },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
  ]);
  assert.deepEqual(parseChatEntry(entry)?.blocks, [
    { kind: 'text', text: '- first point\n- second point' },
    // Argus's temp dir is outside every session folder: no readable path.
    { kind: 'image' },
  ]);
});

test('the new composer layout (paths on their own line) parses the same', () => {
  const tmp = '/tmp/argus-chat-images/6a6548dd-87e5-4254-ac2f-09c3e5130b06.png';
  const entry = user('u1', [
    { type: 'text', text: `[Image #1] [Image #2]\n<pasted_content id="1">\n${tmp} /repo/shot.png\n- item\n</pasted_content id="1">` },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '' } },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '' } },
  ]);
  assert.deepEqual(parseChatEntry(entry)?.blocks, [
    // A user's own file stays in the text; only Argus's temp paths are noise.
    { kind: 'text', text: '/repo/shot.png\n- item' },
    { kind: 'image' },
    { kind: 'image', path: '/repo/shot.png' },
  ]);
});

test('paste wrappers are unwrapped; `[Image #N]` stays without an image block', () => {
  assert.equal(cleanUserText('<pasted_content id="ab">\nhello\n</pasted_content id="ab">'), 'hello');
  assert.equal(cleanUserText('see [Image #3]'), 'see [Image #3]');
  assert.equal(cleanUserText('see [Image #3]', true), 'see');
  assert.equal(cleanUserText('"/private/var/x y/argus-chat-images/a-b.jpg" what is this?'), 'what is this?');
});

test('a stopped turn is a "Stopped" notice; task notifications are hidden (F3)', () => {
  assert.deepEqual(parseChatEntry(user('u1', [{ type: 'text', text: '[Request interrupted by user]' }])), {
    id: 'u1',
    role: 'system',
    blocks: [{ kind: 'notice', text: 'Stopped' }],
    ts: Date.parse('2026-10-23T16:00:00.000Z'),
  });
  assert.deepEqual(parseChatEntry(user('u2', '[Request interrupted by user for tool use]'))?.blocks, [{ kind: 'notice', text: 'Stopped' }]);
  assert.equal(parseChatEntry(user('u3', [{ type: 'text', text: '[Request interrupted by user for tool use]' }]))?.role, 'system');
  assert.equal(parseChatEntry(user('u4', '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>')), undefined);
});

const toolUse = (uuid: string, id: string, name: string, input: unknown, extra: Record<string, unknown> = {}) =>
  assistant(uuid, [{ type: 'tool_use', id, name, input }], extra);
const toolResult = (uuid: string, id: string, content: unknown, extra: Record<string, unknown> = {}) =>
  user(uuid, [{ type: 'tool_result', tool_use_id: id, content, ...extra }]);

test('ChatTail: a tool result in a later entry is joined to its call (in a reset)', async () => {
  const f = tmpFile();
  writeFileSync(
    f,
    [
      toolUse('a1', 't1', 'Bash', { command: 'ls', description: 'List files' }),
      toolUse('a2', 't2', 'Read', { file_path: '/repo/x.ts' }, { cwd: '/repo' }),
      toolResult('r1', 't1', 'a.ts\nb.ts'),
      toolResult('r2', 't2', "The user doesn't want to proceed with this tool use.", { is_error: true }),
    ].join('\n') + '\n',
  );
  const t = new ChatTail(f);
  await t.poll();
  const d = t.drain();
  assert.equal(d.reset, true);
  assert.deepEqual(d.messages.map((m) => m.id), ['a1', 'a2']);
  assert.deepEqual(d.messages[0].blocks, [
    { kind: 'tool', id: 't1', name: 'Bash', label: 'List files', status: 'ok', detail: { command: 'ls', output: 'a.ts\nb.ts' } },
  ]);
  assert.deepEqual(d.messages[1].blocks[0], {
    kind: 'tool',
    id: 't2',
    name: 'Read',
    label: 'x.ts',
    status: 'blocked',
    detail: { path: '/repo/x.ts', output: "The user doesn't want to proceed with this tool use." },
  });
});

test('ChatTail: a result arriving after the call was sent re-sends that message (same id)', async () => {
  const f = tmpFile();
  writeFileSync(f, user('u1', 'go') + '\n' + toolUse('a1', 't1', 'Bash', { command: 'false' }) + '\n');
  const t = new ChatTail(f);
  await t.poll();
  const first = t.drain();
  const sent = first.messages[1];
  assert.equal(sent.blocks[0].kind === 'tool' && sent.blocks[0].status, 'pending');

  appendFileSync(f, toolResult('r1', 't1', 'Exit code 1', { is_error: true }) + '\n' + toolUse('a2', 't2', 'Grep', { pattern: 'x' }) + '\n');
  await t.poll();
  const d = t.drain();
  assert.equal(d.reset, false);
  assert.deepEqual(d.messages.map((m) => m.id), ['a1', 'a2']);
  assert.equal(d.messages[0].blocks[0].kind === 'tool' && d.messages[0].blocks[0].status, 'error');
  // What was sent before is never mutated.
  assert.equal(sent.blocks[0].kind === 'tool' && sent.blocks[0].status, 'pending');
  assert.equal(t.messages[1].blocks[0].kind === 'tool' && t.messages[1].blocks[0].status, 'error');

  // A call and its result in the same read are sent once, already joined.
  appendFileSync(f, toolResult('r2', 't2', 'hit') + '\n');
  await t.poll();
  const d2 = t.drain();
  assert.deepEqual(d2.messages.map((m) => m.id), ['a2']);
  assert.equal(d2.messages[0].blocks[0].kind === 'tool' && d2.messages[0].blocks[0].status, 'ok');

  // A result for an unknown (or already joined) call changes nothing.
  appendFileSync(f, toolResult('r3', 't2', 'again') + '\n' + toolResult('r4', 'nope', 'x') + '\n');
  await t.poll();
  assert.deepEqual(t.drain().messages, []);
  rmSync(path.dirname(f), { recursive: true, force: true });
});

const queuedCommand = (uuid: string, attachment: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'attachment', uuid, timestamp: '2026-10-23T16:00:00.000Z', attachment: { type: 'queued_command', ...attachment }, ...extra });

test('a prompt Claude read mid-turn (queued_command attachment) is a user message', () => {
  const m = parseChatEntry(queuedCommand('q1', { prompt: 'PS. also check the tests', commandMode: 'prompt', origin: { kind: 'human' } }));
  assert.deepEqual(m, { id: 'q1', role: 'user', blocks: [{ kind: 'text', text: 'PS. also check the tests' }], ts: Date.parse('2026-10-23T16:00:00.000Z') });
  // Older Claude Code versions record no origin.
  assert.equal(parseChatEntry(queuedCommand('q2', { prompt: 'and this', commandMode: 'prompt' }))?.role, 'user');
  // A prompt with an image is a block list, as in a user entry.
  assert.deepEqual(
    parseChatEntry(queuedCommand('q3', { prompt: [{ type: 'image', source: {} }, { type: 'text', text: 'see [Image #1]' }], commandMode: 'prompt', origin: { kind: 'human' } }))?.blocks,
    [{ kind: 'image' }, { kind: 'text', text: 'see' }],
  );
});

test('queued task notifications, peer messages and sidechain prompts are not chat messages', () => {
  assert.equal(parseChatEntry(queuedCommand('t1', { prompt: '<task-notification>\n<status>completed</status>\n</task-notification>', commandMode: 'task-notification' })), undefined);
  assert.equal(parseChatEntry(queuedCommand('p1', { prompt: 'from another session', commandMode: 'prompt', origin: { kind: 'peer' } })), undefined);
  assert.equal(parseChatEntry(queuedCommand('s1', { prompt: 'sub', commandMode: 'prompt' }, { isSidechain: true })), undefined);
  // Only harness wrappers: nothing the user typed.
  assert.equal(parseChatEntry(queuedCommand('r1', { prompt: '<system-reminder>x</system-reminder>', commandMode: 'prompt' })), undefined);
  // The queue bookkeeping itself is never a message.
  assert.equal(parseChatEntry(JSON.stringify({ type: 'queue-operation', operation: 'enqueue', content: 'hi', sessionId: 's' })), undefined);
});
