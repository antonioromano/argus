import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { SessionManager } from './SessionManager.js';

process.env.ARGUS_PTY_BACKEND = 'tmux'; // pin backend so a built argusd binary doesn't flip the default

const fakeConfig = {
  load: async () => ({ defaultAgent: 'claude', customAgents: [], agentFlags: {} }),
  save: async () => {},
} as any;

const UUID = '0b0e7a3c-1f2d-4e5f-8a9b-0c1d2e3f4a5b';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mgr() {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'argus-insights-'));
  const sm = new SessionManager(dataDir, fakeConfig);
  const emitted: Array<{ ev: string; p: any }> = [];
  (sm as any).io = { emit: (ev: string, p: any) => emitted.push({ ev, p }), to: () => ({ emit: () => {} }) };
  (sm as any).refreshSleepPrevention = () => {};
  return { sm, emitted, dataDir };
}

function inject(sm: SessionManager, over: Record<string, unknown> = {}): any {
  const s = {
    id: 's',
    name: 't',
    folderPath: os.tmpdir(),
    agentType: 'claude',
    flags: [],
    status: 'idle',
    createdAt: new Date().toISOString(),
    pty: {},
    stateDetector: { getLastPromptText: () => undefined, getStatus: () => 'idle', msSinceLastFeed: () => Infinity },
    persistent: false,
    runMode: 'persistent',
    hasUserInputSinceIdle: false,
    ...over,
  };
  (sm as any).sessions.set('s', s);
  return s;
}

function transcript(dir: string): string {
  const f = path.join(dir, `${UUID}.jsonl`);
  writeFileSync(f, JSON.stringify({
    type: 'assistant',
    message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 } },
  }) + '\n');
  return f;
}

test('applyAgentMeta: records the Claude id and starts the usage meter', async () => {
  const { sm, emitted, dataDir } = mgr();
  const s = inject(sm);
  const f = transcript(dataDir);
  sm.applyAgentMeta('s', { claudeSessionId: UUID, transcriptPath: f });
  assert.equal(s.claudeSessionId, UUID);
  await sleep(600); // debounce + read
  const ev = emitted.find((e) => e.ev === 'session:usage');
  assert.ok(ev, 'usage broadcast');
  assert.equal(ev.p.sessionId, 's');
  assert.equal(ev.p.usage.totalTokens, 1030);
  assert.equal(ev.p.usage.contextTokens, 1010);
  assert.equal(sm.getSessionInfo('s')!.usage!.totalTokens, 1030);
  s.usage.dispose();
  rmSync(dataDir, { recursive: true, force: true });
});

test('applyAgentMeta: ignored for non-Claude agents and unknown sessions', () => {
  const { sm, dataDir } = mgr();
  const s = inject(sm, { agentType: 'gemini' });
  sm.applyAgentMeta('s', { claudeSessionId: UUID, transcriptPath: transcript(dataDir) });
  sm.applyAgentMeta('nope', { claudeSessionId: UUID });
  assert.equal(s.claudeSessionId, undefined);
  assert.equal(s.usage, undefined);
  rmSync(dataDir, { recursive: true, force: true });
});

test('the Claude id and meter state are persisted to sessions.json', async () => {
  const { sm, dataDir } = mgr();
  const s = inject(sm);
  sm.applyAgentMeta('s', { claudeSessionId: UUID, transcriptPath: transcript(dataDir) });
  await s.usage.pollNow();
  await (sm as any).persistSessions();
  const saved = JSON.parse(readFileSync(path.join(dataDir, 'sessions.json'), 'utf8'));
  assert.equal(saved[0].claudeSessionId, UUID);
  assert.equal(saved[0].usage.transcripts[0].totals.cacheRead, 1000);
  s.usage.dispose();
  rmSync(dataDir, { recursive: true, force: true });
});
