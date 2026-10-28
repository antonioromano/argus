import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_TOOL_OUTPUT, displayPath, mcpLabel, toolBlockOf, toolLabel, toolResultsOf, withResult } from './chatTools.js';

test('labels: Bash prefers its description, else the command (first line)', () => {
  assert.equal(toolLabel('Bash', { command: 'ls -la', description: 'List files' }), 'List files');
  assert.equal(toolLabel('Bash', { command: '\ngit status\ngit diff' }), 'git status');
});

test('labels: file tools show the path, relative to cwd when inside it', () => {
  assert.equal(toolLabel('Read', { file_path: '/repo/src/a.ts' }, '/repo'), 'src/a.ts');
  assert.equal(toolLabel('Edit', { file_path: '/elsewhere/b.ts' }, '/repo'), '/elsewhere/b.ts');
  assert.equal(toolLabel('Write', { file_path: '/repo/c.md' }, '/repo/'), 'c.md');
  assert.equal(toolLabel('NotebookEdit', { notebook_path: '/repo/n.ipynb' }, '/repo'), 'n.ipynb');
  assert.equal(displayPath('/repo', '/repo'), '/repo');
});

test('labels: search, agent, ToolSearch, web, skill', () => {
  assert.equal(toolLabel('Grep', { pattern: 'TODO\\b' }), 'TODO\\b');
  assert.equal(toolLabel('Glob', { pattern: '**/*.ts' }), '**/*.ts');
  assert.equal(toolLabel('Agent', { description: 'Find the parser', prompt: '…' }), 'Find the parser');
  assert.equal(toolLabel('Task', { description: 'Review' }), 'Review');
  assert.equal(toolLabel('ToolSearch', { query: 'select:Read,Edit' }), 'Loaded tools Read, Edit');
  assert.equal(toolLabel('ToolSearch', { query: 'slack send' }), 'Loaded tools slack send');
  assert.equal(toolLabel('WebFetch', { url: 'https://x.dev' }), 'https://x.dev');
  assert.equal(toolLabel('Skill', { skill: 'pr-review' }), 'pr-review');
});

test('labels: MCP tools read as "<Server> · <Tool in words>"', () => {
  assert.equal(mcpLabel('mcp__plugin_figma_figma__get_screenshot'), 'Figma · Get screenshot');
  assert.equal(mcpLabel('mcp__claude_ai_Claude_Docs__batch'), 'Claude Docs · Batch');
  assert.equal(mcpLabel('mcp__plugin_chrome-devtools-mcp_chrome-devtools__take_snapshot'), 'Chrome Devtools · Take snapshot');
  assert.equal(mcpLabel('mcp__github__createPullRequest'), 'Github · Createpullrequest');
  assert.equal(mcpLabel('Bash'), undefined);
  assert.equal(toolLabel('mcp__slack__send_message', {}), 'Slack · Send message');
});

test('labels: unknown tools, or a known one missing its field, fall back to the name', () => {
  assert.equal(toolLabel('Hologram', { x: 1 }), 'Hologram');
  assert.equal(toolLabel('Read', {}), 'Read');
  assert.equal(toolLabel('Bash', null), 'Bash');
});

test('details: Bash command, Edit old/new, Write content, other input as JSON', () => {
  assert.deepEqual(toolBlockOf({ id: 't', name: 'Edit', input: { file_path: '/a', old_string: 'x', new_string: 'y' } }).detail, {
    path: '/a',
    oldText: 'x',
    newText: 'y',
  });
  assert.deepEqual(toolBlockOf({ id: 't', name: 'Write', input: { file_path: '/a', content: 'hi' } }).detail, { path: '/a', newText: 'hi' });
  assert.deepEqual(toolBlockOf({ id: 't', name: 'Hologram', input: { a: 1 } }).detail, { input: '{\n  "a": 1\n}' });
  assert.equal(toolBlockOf({ id: 't', name: 'Hologram', input: {} }).detail, undefined);
  const b = toolBlockOf({ name: 42 });
  assert.equal(b.name, 'tool');
  assert.equal(b.id, '');
});

test('results: ok, error, blocked (rejected / denied), clipped output, text parts', () => {
  const [ok, err, rej, denied, parts] = toolResultsOf([
    { type: 'tool_result', tool_use_id: 'a', content: 'x'.repeat(MAX_TOOL_OUTPUT + 10) },
    { type: 'tool_result', tool_use_id: 'b', is_error: true, content: '<tool_use_error>Exit code 1\nls: Permission denied</tool_use_error>' },
    { type: 'tool_result', tool_use_id: 'c', is_error: true, content: "The user doesn't want to proceed with this tool use." },
    { type: 'tool_result', tool_use_id: 'd', is_error: true, content: 'Permission to use Bash with command rm -rf has been denied.' },
    { type: 'tool_result', tool_use_id: 'e', content: [{ type: 'text', text: 'one' }, { type: 'image' }, { type: 'text', text: 'two' }] },
    { type: 'text', text: 'not a result' },
    { type: 'tool_result' },
  ]);
  assert.equal(ok.status, 'ok');
  assert.ok(ok.output!.length < MAX_TOOL_OUTPUT + 30 && ok.output!.endsWith('(truncated)'));
  assert.deepEqual(err, { id: 'b', status: 'error', output: 'Exit code 1\nls: Permission denied' });
  assert.equal(rej.status, 'blocked');
  assert.equal(denied.status, 'blocked');
  assert.equal(parts.output, 'one\ntwo');
  assert.equal(toolResultsOf([{ type: 'tool_result', tool_use_id: 'z', is_error: true, content: 'nope' }], 'User rejected tool use')[0].status, 'blocked');
  assert.deepEqual(toolResultsOf('a string'), []);
});

test('withResult copies the block and keeps its details', () => {
  const b = toolBlockOf({ id: 't', name: 'Bash', input: { command: 'ls' } });
  const next = withResult(b, { id: 't', status: 'ok', output: 'a.ts' });
  assert.equal(b.status, 'pending');
  assert.deepEqual(next.detail, { command: 'ls', output: 'a.ts' });
});
