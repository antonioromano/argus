import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVITY_PAYLOAD_CAP,
  ACTIVITY_SUMMARY_MAX,
  activityFromPayload,
  clip,
  parseHookPayload,
  summarizeTool,
} from './activitySummary.js';

const post = (tool_name: string, tool_input: Record<string, unknown>, tool_response: unknown = {}) =>
  JSON.stringify({
    session_id: 'abc',
    transcript_path: '/t.jsonl',
    cwd: '/repo',
    hook_event_name: 'PostToolUse',
    tool_name,
    tool_input,
    tool_response,
    tool_use_id: 'toolu_1',
  });

test('Bash: the command, truncated to 200 characters with an ellipsis', () => {
  const long = 'echo ' + 'x'.repeat(500);
  const e = activityFromPayload(post('Bash', { command: long, description: 'print' }))!;
  assert.equal(e.type, 'tool');
  assert.equal(e.tool, 'Bash');
  assert.equal(e.summary.length, ACTIVITY_SUMMARY_MAX);
  assert.ok(e.summary.startsWith('echo xxx'));
  assert.ok(e.summary.endsWith('…'));
});

test('Bash: multi-line commands collapse to one line', () => {
  assert.equal(summarizeTool('Bash', { command: 'cd a &&\n  npm   test' }).summary, 'cd a && npm test');
});

test('Write shows the path only, never the content', () => {
  const e = activityFromPayload(post('Write', { file_path: '/repo/src/a.ts', content: 'SECRET_BODY' }, { filePath: '/repo/src/a.ts' }))!;
  assert.equal(e.summary, '/repo/src/a.ts');
  assert.equal(e.filePath, '/repo/src/a.ts');
  assert.ok(!JSON.stringify(e).includes('SECRET_BODY'));
});

test('Edit shows the path only, never old/new strings', () => {
  const e = activityFromPayload(post('Edit', { file_path: '/r/b.ts', old_string: 'OLD_BODY', new_string: 'NEW_BODY' }))!;
  assert.equal(e.summary, '/r/b.ts');
  assert.ok(!/OLD_BODY|NEW_BODY/.test(JSON.stringify(e)));
});

test('Read with a tool_response full of file content shows the path only', () => {
  const e = activityFromPayload(post('Read', { file_path: '/r/c.ts' }, { file: { filePath: '/r/c.ts', content: 'CONTENT' } }))!;
  assert.equal(e.summary, '/r/c.ts');
  assert.ok(!JSON.stringify(e).includes('CONTENT'));
});

test('Grep / Glob / WebFetch / WebSearch / Agent summaries', () => {
  assert.equal(summarizeTool('Grep', { pattern: 'TODO', path: 'src' }).summary, 'TODO in src');
  assert.equal(summarizeTool('Glob', { pattern: '**/*.ts' }).summary, '**/*.ts');
  assert.equal(summarizeTool('WebFetch', { url: 'https://x.dev' }).summary, 'https://x.dev');
  assert.equal(summarizeTool('WebSearch', { query: 'hooks' }).summary, 'hooks');
  assert.equal(summarizeTool('Agent', { subagent_type: 'Explore', description: 'find X' }).summary, 'Explore: find X');
});

test('unknown tools: the tool name with an empty summary (no input is echoed)', () => {
  const e = activityFromPayload(post('mcp__db__query', { sql: 'select password from users', command: 'x' }))!;
  assert.equal(e.type, 'tool');
  assert.equal(e.tool, 'mcp__db__query');
  assert.equal(e.summary, '');
});

test('oversized Write payload: truncated mid-content still yields the path only', () => {
  const huge = post('Write', { file_path: '/repo/big.txt', content: 'A'.repeat(5_000_000) });
  const e = activityFromPayload(huge)!;
  assert.equal(e.tool, 'Write');
  assert.equal(e.summary, '/repo/big.txt');
  assert.equal(e.filePath, '/repo/big.txt');
});

test('parseHookPayload reads a truncated payload tolerantly', () => {
  const head = post('Bash', { command: 'ls "a b"\\n', description: 'list' }).slice(0, 150);
  const h = parseHookPayload(head);
  assert.ok(h);
  assert.equal(h!.event, 'PostToolUse');
  assert.equal(h!.toolName, 'Bash');
});

test('a Bash command cut off by the cap still shows its head', () => {
  const raw = post('Bash', { command: 'cat <<EOF\n' + 'y'.repeat(ACTIVITY_PAYLOAD_CAP * 2) }).slice(0, ACTIVITY_PAYLOAD_CAP);
  const e = activityFromPayload(raw)!;
  assert.ok(e.summary.startsWith('cat <<EOF yyy'));
  assert.equal(e.summary.length, ACTIVITY_SUMMARY_MAX);
});

test('a path cut off by the cap is dropped, not guessed', () => {
  const raw = post('Write', { file_path: '/repo/' + 'd/'.repeat(10_000) + 'f.ts', content: 'x' }).slice(0, ACTIVITY_PAYLOAD_CAP);
  const e = activityFromPayload(raw)!;
  assert.equal(e.summary, '');
  assert.equal(e.filePath, undefined);
});

test('a tool_input key inside escaped content never matches', () => {
  const raw = post('Write', { file_path: '/r/x.json', content: '{"file_path":"/etc/passwd"}' }).slice(0, 200);
  assert.equal(activityFromPayload(raw)!.filePath, '/r/x.json');
});

test('non-tool events', () => {
  const ev = (o: Record<string, unknown>) => activityFromPayload(JSON.stringify({ session_id: 's', ...o }));
  assert.deepEqual(ev({ hook_event_name: 'SubagentStop', agent_type: 'Explore', last_assistant_message: 'LONG' }), { type: 'subagent', summary: 'Explore finished' });
  assert.deepEqual(ev({ hook_event_name: 'PreCompact', trigger: 'auto', custom_instructions: null }), { type: 'compact', summary: 'Auto-compact' });
  assert.deepEqual(ev({ hook_event_name: 'PreCompact', trigger: 'manual' }), { type: 'compact', summary: 'Manual compact' });
  assert.deepEqual(ev({ hook_event_name: 'UserPromptSubmit', prompt: 'fix the\ntests' }), { type: 'prompt', summary: 'fix the tests' });
  assert.deepEqual(ev({ hook_event_name: 'Notification', message: 'Claude needs your permission' }), { type: 'notification', summary: 'Claude needs your permission' });
  assert.equal(ev({ hook_event_name: 'Stop', last_assistant_message: 'done' })!.type, 'stop');
  assert.equal(ev({ hook_event_name: 'SessionStart' }), null);
});

test('garbage and payloads without an event name are ignored', () => {
  assert.equal(activityFromPayload(''), null);
  assert.equal(activityFromPayload('not json'), null);
  assert.equal(activityFromPayload('{"tool_name":"Bash"}'), null);
  assert.equal(activityFromPayload(JSON.stringify({ hook_event_name: 'PostToolUse' })), null);
});

test('clip strips control characters', () => {
  assert.equal(clip('a\u0007b\u001b[31mc'), 'a b [31mc');
});
