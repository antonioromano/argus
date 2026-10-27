import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LaunchRequest, SessionInfo } from '@argus/shared';
import { createMcpTools, parseStartArgs, MCP_MAX_PROMPT, READ_MAX_LINES, type McpHost, type McpCaller } from './tools.js';
import { ToolError } from './protocol.js';

const ORCH = '11111111-1111-4111-8111-111111111111';
const CHILD = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const caller: McpCaller = { sessionId: ORCH, name: 'orchestrator' };

const info = (id: string, over: Partial<SessionInfo> = {}): SessionInfo => ({
  id, name: `s-${id.slice(0, 4)}`, folderPath: '/repo', status: 'idle', createdAt: '', agentType: 'claude', flags: [], ...over,
} as SessionInfo);

function host(over: Partial<McpHost> = {}) {
  const log: string[] = [];
  const sessions = new Map<string, SessionInfo>([
    [ORCH, info(ORCH)],
    [CHILD, info(CHILD, { spawnedBy: ORCH, status: 'waiting', lastPrompt: 'Proceed?', worktreeBranch: 'feat/x' })],
    [OTHER, info(OTHER)],
  ]);
  const h: McpHost = {
    listSessions: () => [...sessions.values()],
    getSession: (id) => sessions.get(id),
    tail: (id, n) => { log.push(`tail:${id}:${n}`); return ['a', 'b']; },
    validate: async (req: LaunchRequest) => { log.push(`validate:${req.folder}`); return { ok: true, value: { request: req, agentCommand: 'claude', args: [], command: 'claude', warnings: [], folderAgentConfig: [] } }; },
    requestLaunch: async (v, c) => { log.push(`request:${c.sessionId}:${v.request.prompt}`); sessions.set(CHILD, info(CHILD, { spawnedBy: ORCH })); return { ok: true, sessionId: CHILD }; },
    submit: async (id, text) => { log.push(`submit:${id}:${text}`); return true; },
    interrupt: (id) => { log.push(`interrupt:${id}`); },
    ...over,
  };
  const tools = createMcpTools(h, '/Users/me');
  const run = (name: string, args: Record<string, unknown>) => tools.find((t) => t.name === name)!.run(args, caller);
  return { log, run, sessions };
}

test('parseStartArgs: expands ~, defaults to claude, never passes flags', () => {
  const r = parseStartArgs({ prompt: 'do it', folder: '~/dev/repo', worktree: 'feat/a', base: 'main', name: 'A' }, '/Users/me');
  assert.deepEqual(r, { agent: 'claude', folder: '/Users/me/dev/repo', flags: [], prompt: 'do it', name: 'A', worktree: 'feat/a', base: 'main' });
});

test('parseStartArgs rejects bad shapes', () => {
  const bad: Record<string, unknown>[] = [
    { folder: '/r' },
    { prompt: '  ', folder: '/r' },
    { prompt: '--dangerously-skip-permissions', folder: '/r' },
    { prompt: 'x'.repeat(MCP_MAX_PROMPT + 1), folder: '/r' },
    { prompt: 'a\u0007b', folder: '/r' },
    { prompt: 'a‮b', folder: '/r' },
    { prompt: 'x', folder: 'relative/path' },
    { prompt: 'x', folder: '/r', agent: 'bad agent' },
    { prompt: 'x', folder: '/r', base: 'main' },
    { prompt: 'x', folder: '/r', worktree: '../escape' },
    { prompt: 'x', folder: '/r', worktree: '-b' },
    { prompt: 'x', folder: '/r', name: 'n'.repeat(61) },
    { prompt: 'x', folder: 7 },
  ];
  for (const args of bad) assert.throws(() => parseStartArgs(args, '/h'), ToolError, JSON.stringify(args).slice(0, 60));
  assert.doesNotThrow(() => parseStartArgs({ prompt: 'line 1\n\tline 2', folder: '/r' }, '/h'), 'newline and tab are fine');
});

test('start_session goes through the approval hook and returns the new id', async () => {
  const { run, log } = host();
  const r = await run('start_session', { prompt: 'go', folder: '/repo' });
  assert.deepEqual(log, ['validate:/repo', `request:${ORCH}:go`]);
  assert.equal(r.isError, undefined);
  assert.equal(r.structuredContent?.id, CHILD);
});

test('start_session: invalid launch and a declined card are tool errors, never a launch', async () => {
  const invalid = host({ validate: async () => ({ ok: false, error: 'Folder does not exist' }) });
  await assert.rejects(invalid.run('start_session', { prompt: 'go', folder: '/nope' }), /Folder does not exist/);
  assert.ok(!invalid.log.some((l) => l.startsWith('request:')));

  const declined = host({ requestLaunch: async () => ({ ok: false, error: 'The user discarded this launch in Argus' }) });
  await assert.rejects(declined.run('start_session', { prompt: 'go', folder: '/repo' }), /discarded/);

  const noUi = host({ requestLaunch: undefined });
  await assert.rejects(noUi.run('start_session', { prompt: 'go', folder: '/repo' }), /approval card/);
});

test('list_sessions marks the caller and its children', async () => {
  const { run } = host();
  const r = await run('list_sessions', {});
  const list = r.structuredContent?.sessions as any[];
  assert.equal(list.length, 3);
  assert.equal(list.find((s) => s.id === ORCH).self, true);
  assert.equal(list.find((s) => s.id === CHILD).startedByYou, true);
  assert.equal(list.find((s) => s.id === OTHER).startedByYou, false);
});

test('read_session: any session, clamped line count, waiting prompt surfaced', async () => {
  const { run, log } = host();
  const r = await run('read_session', { id: CHILD, lines: 10_000 });
  assert.deepEqual(log, [`tail:${CHILD}:${READ_MAX_LINES}`]);
  assert.equal(r.structuredContent?.waitingFor, 'Proceed?');
  assert.equal(r.structuredContent?.branch, 'feat/x');
  assert.equal(r.structuredContent?.output, 'a\nb');
  await run('read_session', { id: OTHER });
  assert.equal(log[1], `tail:${OTHER}:40`);
  await assert.rejects(run('read_session', { id: 'not-a-uuid' }), ToolError);
  await assert.rejects(run('read_session', { id: CHILD, lines: 0 }), ToolError);
});

test('send_input / stop_session reach only the caller’s own children', async () => {
  const { run, log } = host();
  await run('send_input', { id: CHILD, text: 'yes' });
  await run('stop_session', { id: CHILD });
  assert.deepEqual(log, [`submit:${CHILD}:yes`, `interrupt:${CHILD}`]);
  for (const id of [OTHER, ORCH]) {
    await assert.rejects(run('send_input', { id, text: 'rm -rf' }), /Only sessions you started/);
    await assert.rejects(run('stop_session', { id }), /Only sessions you started/);
  }
  assert.equal(log.length, 2, 'nothing reached a session the caller did not start');
});

test('send_input validates text and refuses an exited child', async () => {
  const { run, sessions } = host();
  await assert.rejects(run('send_input', { id: CHILD, text: '' }), /text is required/);
  await assert.rejects(run('send_input', { id: CHILD, text: 'a\u001b[2J' }), /control characters/);
  sessions.set(CHILD, info(CHILD, { spawnedBy: ORCH, status: 'exited' }));
  await assert.rejects(run('send_input', { id: CHILD, text: 'hi' }), /has exited/);
});
