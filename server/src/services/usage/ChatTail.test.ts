import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { ChatTail, MAX_CHAT_MESSAGES, MAX_CHAT_TEXT, cleanUserText, parseChatEntry, parseChatLine } from './ChatTail.js';

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

test('tool calls become name-only blocks; thinking and tool results are dropped', () => {
  assert.deepEqual(parseChatEntry(assistant('a1', [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }]))?.blocks, [
    { kind: 'tool', name: 'Bash' },
  ]);
  assert.equal(parseChatEntry(assistant('a2', [{ type: 'thinking', thinking: '' }])), undefined);
  assert.equal(parseChatEntry(user('u1', [{ type: 'tool_result', content: 'out' }])), undefined);
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
