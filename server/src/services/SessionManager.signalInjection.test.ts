import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { SessionManager } from './SessionManager.js';
import { computeSignalToken } from './agentSignals/token.js';

const fakeConfig = {
  load: async () => ({ defaultAgent: 'claude', customAgents: [], agentFlags: {} }),
  save: async () => {},
} as any;

function sm(): SessionManager {
  const m = new SessionManager(os.tmpdir(), fakeConfig);
  m.setSignalConfig('test-secret', '/opt/argus/bin/argus-signal');
  return m;
}

const build = (m: SessionManager, agent: string, flags: string[]) =>
  (m as any).buildSignalInjection('sess-X', agent, flags);

test('buildSignalInjection (claude): flags + common env + coverage', () => {
  const inj = build(sm(), 'claude', ['--model', 'opus']);
  assert.ok(inj, 'claude has an adapter');
  assert.ok(inj.flags.includes('--settings'), 'adds --settings flag');
  const port = process.env.ARGUS_PORT || process.env.PORT || '5401';
  assert.equal(inj.env.ARGUS_SIGNAL_URL, `http://127.0.0.1:${port}/api/agent-signals`, 'loopback ingestion URL');
  assert.equal(inj.env.ARGUS_SIGNAL_TOKEN, computeSignalToken('test-secret', 'sess-X'), 'per-session HMAC token');
  assert.equal(inj.files.length, 1, 'writes one settings file');
  assert.deepEqual([...inj.coverage], ['running', 'waiting', 'idle']);
});

test('buildSignalInjection returns null for agents without an adapter (gemini/codex — Units 4/5)', () => {
  assert.equal(build(sm(), 'gemini', []), null);
  assert.equal(build(sm(), 'codex', []), null);
});

test('buildSignalInjection returns null when signals are unconfigured', () => {
  const m = new SessionManager(os.tmpdir(), fakeConfig); // no setSignalConfig
  assert.equal(build(m, 'claude', []), null);
});

test('buildSignalInjection honors ARGUS_PORT for the ingestion URL', () => {
  const prev = process.env.ARGUS_PORT;
  process.env.ARGUS_PORT = '5757';
  try {
    const inj = build(sm(), 'claude', []);
    assert.equal(inj.env.ARGUS_SIGNAL_URL, 'http://127.0.0.1:5757/api/agent-signals');
  } finally {
    if (prev === undefined) delete process.env.ARGUS_PORT;
    else process.env.ARGUS_PORT = prev;
  }
});
