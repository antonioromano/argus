import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { fileURLToPath } from 'url';
import path from 'path';

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../resources/bin/argus-signal',
);

interface Captured {
  url: string;
  body: any;
}
let server: Server;
let baseUrl: string;
let received: Captured[] = [];

before(async () => {
  server = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      let body: any = null;
      try {
        body = JSON.parse(data);
      } catch {
        body = data;
      }
      received.push({ url: req.url ?? '', body });
      res.statusCode = 204;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/api/agent-signals`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function run(args: string[], env: Record<string, string>, stdin?: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(SCRIPT, args, { env: { ...process.env, ...env } });
    if (stdin !== undefined) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
    child.on('close', (code) => resolve(code));
  });
}

test('posts {token,state} to /:session with the injected env', async () => {
  received = [];
  const code = await run(
    ['--session', 'sess-1', '--state', 'idle'],
    { ARGUS_SIGNAL_URL: baseUrl, ARGUS_SIGNAL_TOKEN: 'tok-123' },
  );
  assert.equal(code, 0);
  assert.equal(received.length, 1);
  assert.equal(received[0]!.url, '/api/agent-signals/sess-1');
  assert.deepEqual(received[0]!.body, { token: 'tok-123', state: 'idle' });
});

test('--prompt-from-stdin extracts the hook message into promptText', async () => {
  received = [];
  const hookJson = '{"hook_event_name":"Notification","message":"Approve edit to foo.ts?","cwd":"/x"}';
  const code = await run(
    ['--session', 'sess-2', '--state', 'waiting', '--prompt-from-stdin'],
    { ARGUS_SIGNAL_URL: baseUrl, ARGUS_SIGNAL_TOKEN: 'tok-2' },
    hookJson,
  );
  assert.equal(code, 0);
  assert.equal(received.length, 1);
  assert.equal(received[0]!.body.state, 'waiting');
  assert.equal(received[0]!.body.promptText, 'Approve edit to foo.ts?');
});

test('trailing slash on the base URL is normalized', async () => {
  received = [];
  await run(
    ['--session', 'sess-3', '--state', 'running'],
    { ARGUS_SIGNAL_URL: `${baseUrl}/`, ARGUS_SIGNAL_TOKEN: 't' },
  );
  assert.equal(received[0]!.url, '/api/agent-signals/sess-3');
});

test('missing env → no request, exits 0 (never blocks the agent)', async () => {
  received = [];
  const code = await run(
    ['--session', 'sess-4', '--state', 'idle'],
    { ARGUS_SIGNAL_URL: '', ARGUS_SIGNAL_TOKEN: '' },
  );
  assert.equal(code, 0);
  assert.equal(received.length, 0);
});

test('missing --state → no request, exits 0', async () => {
  received = [];
  const code = await run(['--session', 'sess-5'], {
    ARGUS_SIGNAL_URL: baseUrl,
    ARGUS_SIGNAL_TOKEN: 't',
  });
  assert.equal(code, 0);
  assert.equal(received.length, 0);
});

const HOOK_JSON =
  '{"session_id":"0b0e7a3c-1f2d-4e5f-8a9b-0c1d2e3f4a5b","transcript_path":"/Users/u/.claude/projects/-x/0b0e7a3c-1f2d-4e5f-8a9b-0c1d2e3f4a5b.jsonl","hook_event_name":"Stop","cwd":"/x"}';

test('--hook-stdin forwards session_id and transcript_path with the state', async () => {
  received = [];
  const code = await run(
    ['--session', 'sess-6', '--state', 'idle', '--hook-stdin'],
    { ARGUS_SIGNAL_URL: baseUrl, ARGUS_SIGNAL_TOKEN: 't6' },
    HOOK_JSON,
  );
  assert.equal(code, 0);
  assert.deepEqual(received[0]!.body, {
    token: 't6',
    state: 'idle',
    claudeSessionId: '0b0e7a3c-1f2d-4e5f-8a9b-0c1d2e3f4a5b',
    transcriptPath: '/Users/u/.claude/projects/-x/0b0e7a3c-1f2d-4e5f-8a9b-0c1d2e3f4a5b.jsonl',
  });
});

test('--hook-stdin without --state posts metadata only', async () => {
  received = [];
  await run(['--session', 'sess-7', '--hook-stdin'], { ARGUS_SIGNAL_URL: baseUrl, ARGUS_SIGNAL_TOKEN: 't7' }, HOOK_JSON);
  assert.equal(received.length, 1);
  assert.equal(received[0]!.body.state, undefined);
  assert.equal(received[0]!.body.claudeSessionId, '0b0e7a3c-1f2d-4e5f-8a9b-0c1d2e3f4a5b');
});

test('--hook-stdin with no state and nothing on stdin sends nothing', async () => {
  received = [];
  const code = await run(['--session', 'sess-8', '--hook-stdin'], { ARGUS_SIGNAL_URL: baseUrl, ARGUS_SIGNAL_TOKEN: 't8' }, '');
  assert.equal(code, 0);
  assert.equal(received.length, 0);
});

test('--prompt-from-stdin and --hook-stdin share one stdin read', async () => {
  received = [];
  const json = '{"session_id":"0b0e7a3c-1f2d-4e5f-8a9b-0c1d2e3f4a5b","message":"Allow Bash?","transcript_path":"/t/a.jsonl"}';
  await run(['--session', 'sess-9', '--state', 'waiting', '--prompt-from-stdin', '--hook-stdin'], { ARGUS_SIGNAL_URL: baseUrl, ARGUS_SIGNAL_TOKEN: 't9' }, json);
  assert.equal(received[0]!.body.promptText, 'Allow Bash?');
  assert.equal(received[0]!.body.transcriptPath, '/t/a.jsonl');
});
