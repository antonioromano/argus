import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AppConfig, AppEnvironment } from '@argus/shared';
import { DEFAULT_CONFIG } from '../persistence/ConfigStore.js';
import {
  CONFIG_DIAG_POLICY, agentLabel, buildAppDiagnostics, redactConfig, redactLine,
  type DiagnosticsInput, type ServerFacts,
} from './AppDiagnostics.js';

const HOME = '/Users/jdoe';

const env: AppEnvironment = {
  appVersion: '0.31.0',
  build: { sha: 'abc1234', builtAt: '2026-10-29T10:00:00Z', dirty: false },
  packaged: true,
  macos: '26.1',
  arch: 'arm64',
  electron: '39.0.0',
  chrome: '142.0',
  node: '22.20.0',
};

function facts(over: Partial<ServerFacts> = {}): ServerFacts {
  return {
    backend: { configured: 'auto', active: 'daemon', socket: 'argusd-argus.sock', daemonConnected: true, duplicateDaemons: 0 },
    sessions: { total: 2, byStatus: { running: 1, waiting: 1 }, byAgent: { claude: 2 }, byRunMode: { persistent: 2 }, byEngine: { xterm: 2 } },
    windows: 1,
    remote: { exposed: false, authEnabled: false, ngrokInstalled: true, ngrokTunnel: 'stopped' },
    betaFlags: [],
    uptimeSec: 42,
    config: redactConfig(DEFAULT_CONFIG),
    ...over,
  };
}

function input(over: Partial<DiagnosticsInput> = {}): DiagnosticsInput {
  return { environment: env, server: facts(), logs: { recent: [], update: [] }, home: HOME, generatedAt: '2026-10-29T12:00:00Z', ...over };
}

test('every DEFAULT_CONFIG key has a diagnostics policy', () => {
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    assert.ok(Object.hasOwn(CONFIG_DIAG_POLICY, key), `no policy for ${key}`);
  }
});

test('agent flag values and custom agent commands never reach the output', () => {
  const cfg: AppConfig = {
    ...DEFAULT_CONFIG,
    defaultAgent: 'my-secret-agent',
    agentFlags: { claude: [{ flag: '--api-key', value: 'sk-123-SECRET', enabled: true }] } as unknown as AppConfig['agentFlags'],
    customAgents: [{ id: 'my-secret-agent', name: 'Mine', command: 'run --token tok-SECRET', builtin: false }] as unknown as AppConfig['customAgents'],
    launchFolderRoots: ['/Users/jdoe/clients/acme'],
    othersFolderName: 'Acme stuff',
  };
  const red = redactConfig(cfg);
  assert.equal(red.agentFlags, '1 entries');
  assert.equal(red.customAgents, '1 entries');
  assert.equal(red.launchFolderRoots, '1 entries');
  assert.equal(red.othersFolderName, '<set>');
  assert.equal(red.defaultAgent, 'custom');

  const { markdown, summary } = buildAppDiagnostics(input({ server: facts({ config: red }) }));
  for (const secret of ['sk-123', 'tok-SECRET', 'my-secret-agent', 'acme', 'Acme', '/Users/jdoe']) {
    assert.ok(!markdown.includes(secret), `markdown leaks ${secret}`);
    assert.ok(!summary.includes(secret), `summary leaks ${secret}`);
  }
});

test('a secret-sounding future key is dropped even if classified include', () => {
  const policies = CONFIG_DIAG_POLICY as Record<string, string>;
  policies.fooToken = 'include';
  try {
    const red = redactConfig({ fooToken: 'xyz', keyboardShortcuts: { 'new-session': 'mod+n' } });
    assert.equal(red.fooToken, undefined);
    assert.deepEqual(red.keyboardShortcuts, { 'new-session': 'mod+n' });
  } finally {
    delete policies.fooToken;
  }
});

test('unknown config keys are omitted', () => {
  assert.deepEqual(redactConfig({ somethingNew: 'x' }), {});
});

test('agentLabel keeps built-ins only', () => {
  assert.equal(agentLabel('claude'), 'claude');
  assert.equal(agentLabel('codex'), 'codex');
  assert.equal(agentLabel('acme-bot'), 'custom');
  assert.equal(agentLabel(undefined), 'none');
});

test('redactLine scrubs paths, credentials, ngrok URLs and long hex', () => {
  assert.equal(redactLine('failed to watch /Users/jdoe/projects/acme: EMFILE', HOME), 'failed to watch <path>: EMFILE');
  assert.equal(redactLine('read /Users/other/x.txt', HOME), 'read <path>');
  assert.equal(redactLine('see ~/.argus/worktrees', HOME), 'see <path>');
  assert.equal(redactLine('Authorization: Bearer abc.def', HOME), 'Authorization: Bearer <redacted>');
  assert.equal(redactLine('ngrok config add-authtoken 2abcXYZ', HOME), 'ngrok config add-authtoken <redacted>');
  assert.equal(redactLine('tunnel at https://ab12.ngrok-free.app ready', HOME), 'tunnel at <redacted> ready');
  assert.equal(redactLine('GET /api?token=s3cret&x=1', HOME), 'GET /api?token=<redacted>&x=1');
  assert.equal(redactLine('spawn claude --api-key sk-123 --verbose', HOME), 'spawn claude --api-key <redacted> --verbose');
  assert.equal(redactLine(`hash ${'a1'.repeat(20)} done`, HOME), 'hash <hex> done');
  const long = redactLine('x'.repeat(2000), HOME);
  assert.equal(long.length, 500);
});

test('log tails are redacted in the markdown', () => {
  const { markdown } = buildAppDiagnostics(input({
    logs: { recent: ['2026 warn spawn failed in /Users/jdoe/acme'], update: ['brew token=abc'] },
  }));
  assert.ok(!markdown.includes('/Users/jdoe'));
  assert.ok(markdown.includes('spawn failed in <path>'));
  assert.ok(markdown.includes('token=<redacted>'));
});

test('sections come in a stable order', () => {
  const { markdown } = buildAppDiagnostics(input());
  const order = ['### Environment', '### Backend', '### Sessions', '### Remote', '### Config', '### Recent log', '### update.log']
    .map((h) => markdown.indexOf(h));
  assert.ok(order.every((i) => i >= 0), String(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test('the summary stays short even with many sessions and agents', () => {
  const byAgent = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`agent${i}`, 1]));
  const { summary } = buildAppDiagnostics(input({ server: facts({ sessions: { total: 500, byStatus: { running: 500 }, byAgent, byRunMode: {}, byEngine: {} } }) }));
  assert.ok(Buffer.byteLength(summary) <= 1500, `${Buffer.byteLength(summary)} bytes`);
});

test('a dev run with no build stamp says so', () => {
  const { markdown } = buildAppDiagnostics(input({ environment: { ...env, build: null, packaged: false } }));
  assert.match(markdown, /Build: dev/);
});
