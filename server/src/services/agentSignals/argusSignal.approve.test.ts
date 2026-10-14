import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { fileURLToPath } from 'url';
import { mkdtempSync, realpathSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import express from 'express';
import type { AutoApprovalRule } from '@argus/shared';
import { createAgentSignalRoutes } from '../../routes/agentSignals.js';
import { computeSignalToken } from './token.js';
import { AutoApprovalService } from '../autoApproval/AutoApprovalService.js';
import type { SessionManager } from '../SessionManager.js';

/**
 * End to end for `argus-signal --approve`: the real script, the real route and
 * the real decision service. What matters is stdout — it is the hook's answer.
 */

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../resources/bin/argus-signal');
const SECRET = 'approve-secret';
const SESSION = 'sess-approve';
const TOKEN = computeSignalToken(SECRET, SESSION);

let folder: string;
let server: Server;
let base: string;
let rules: AutoApprovalRule[] = [];
let enabled = true;

function run(args: string[], env: Record<string, string>, stdin: string): Promise<{ code: number | null; stdout: string; ms: number }> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(SCRIPT, args, { env: { ...process.env, ...env } });
    let stdout = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
    child.on('close', (code) => resolve({ code, stdout, ms: performance.now() - t0 }));
  });
}

function hook(toolName: string, toolInput: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    session_id: '0b0e7a3c-1f2d-4e5f-8a9b-0c1d2e3f4a5b',
    transcript_path: '/t/a.jsonl',
    cwd: folder,
    permission_mode: 'default',
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: 'toolu_1',
    ...extra,
  });
}

const env = () => ({ ARGUS_SIGNAL_URL: base, ARGUS_SIGNAL_TOKEN: TOKEN });

before(async () => {
  folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'argus-approve-')));
  const service = new AutoApprovalService({
    store: { rulesFor: (f) => (f === folder ? rules : []) },
    isEnabled: () => enabled,
    getSession: (id) => (id === SESSION ? { folderPath: folder, agentType: 'claude', status: 'running' } : undefined),
  });
  const app = express();
  app.use('/api/agent-signals', createAgentSignalRoutes({} as SessionManager, () => SECRET, (id, h) => service.decide(id, h)));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/agent-signals`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(folder, { recursive: true, force: true });
});

const gitStatus: AutoApprovalRule = { id: '00000000-0000-4000-8000-000000000001', tool: 'Bash', bashPrefix: 'git status', createdAt: 'x' };

test('a matching rule prints exactly the PreToolUse allow JSON', async () => {
  rules = [gitStatus];
  enabled = true;
  const { code, stdout } = await run(['--session', SESSION, '--approve'], env(), hook('Bash', { command: 'git status -s' }));
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout), {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: `Auto-approved by Argus rule ${gitStatus.id}`,
    },
  });
});

test('no matching rule → empty stdout, exit 0', async () => {
  rules = [gitStatus];
  const { code, stdout } = await run(['--session', SESSION, '--approve'], env(), hook('Bash', { command: 'npm test' }));
  assert.equal(code, 0);
  assert.equal(stdout, '');
});

test('chained command on an allowed prefix → empty stdout', async () => {
  rules = [gitStatus];
  const { stdout } = await run(['--session', SESSION, '--approve'], env(), hook('Bash', { command: 'git status; rm -rf ~' }));
  assert.equal(stdout, '');
});

test('global switch off → empty stdout even when a rule matches', async () => {
  rules = [gitStatus];
  enabled = false;
  const { stdout } = await run(['--session', SESSION, '--approve'], env(), hook('Bash', { command: 'git status' }));
  enabled = true;
  assert.equal(stdout, '');
});

test('wrong token → empty stdout', async () => {
  rules = [gitStatus];
  const { stdout } = await run(['--session', SESSION, '--approve'], { ARGUS_SIGNAL_URL: base, ARGUS_SIGNAL_TOKEN: 'nope' }, hook('Bash', { command: 'git status' }));
  assert.equal(stdout, '');
});

test('missing wiring → empty stdout, exit 0', async () => {
  const { code, stdout } = await run(['--session', SESSION, '--approve'], { ARGUS_SIGNAL_URL: '', ARGUS_SIGNAL_TOKEN: '' }, hook('Bash', { command: 'git status' }));
  assert.equal(code, 0);
  assert.equal(stdout, '');
});

test('payload over the cap → empty stdout (no truncated JSON is trusted)', async () => {
  rules = [{ id: '00000000-0000-4000-8000-000000000002', tool: 'Write', pathGlob: '**', createdAt: 'x' }];
  const big = hook('Write', { file_path: path.join(folder, 'a.txt'), content: 'x'.repeat(600_000) });
  const { code, stdout } = await run(['--session', SESSION, '--approve'], env(), big);
  assert.equal(code, 0);
  assert.equal(stdout, '');
});

test('malformed hook JSON → empty stdout', async () => {
  rules = [gitStatus];
  const { stdout } = await run(['--session', SESSION, '--approve'], env(), '{"tool_name":"Bash", nope');
  assert.equal(stdout, '');
});

test('server down → empty stdout, exit 0', async () => {
  const { code, stdout } = await run(['--session', SESSION, '--approve'], { ARGUS_SIGNAL_URL: 'http://127.0.0.1:9/api/agent-signals', ARGUS_SIGNAL_TOKEN: TOKEN }, hook('Bash', { command: 'git status' }));
  assert.equal(code, 0);
  assert.equal(stdout, '');
});

test('server that never answers → empty stdout within the ~1s timeout', async () => {
  const hang = createServer(() => { /* never respond */ });
  await new Promise<void>((resolve) => hang.listen(0, '127.0.0.1', () => resolve()));
  const url = `http://127.0.0.1:${(hang.address() as AddressInfo).port}/api/agent-signals`;
  try {
    const { code, stdout, ms } = await run(['--session', SESSION, '--approve'], { ARGUS_SIGNAL_URL: url, ARGUS_SIGNAL_TOKEN: TOKEN }, hook('Bash', { command: 'git status' }));
    assert.equal(code, 0);
    assert.equal(stdout, '');
    assert.ok(ms < 2500, `took ${ms.toFixed(0)}ms`);
  } finally {
    hang.closeAllConnections();
    await new Promise<void>((resolve) => hang.close(() => resolve()));
  }
});

test('a 200 reply that is not a hookSpecificOutput object is never printed', async () => {
  const fake = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"decision":"approve"}');
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', () => resolve()));
  const url = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/api/agent-signals`;
  try {
    const { stdout } = await run(['--session', SESSION, '--approve'], { ARGUS_SIGNAL_URL: url, ARGUS_SIGNAL_TOKEN: TOKEN }, hook('Bash', { command: 'git status' }));
    assert.equal(stdout, '');
  } finally {
    await new Promise<void>((resolve) => fake.close(() => resolve()));
  }
});
