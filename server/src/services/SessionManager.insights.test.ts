import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
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
  process.env.CLAUDE_CONFIG_DIR = dataDir;
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

/** Writes under `<dir>/projects/` — mgr() points CLAUDE_CONFIG_DIR at `dir`,
 *  so the file sits where Claude keeps transcripts. */
function transcript(dir: string): string {
  mkdirSync(path.join(dir, 'projects', '-x'), { recursive: true });
  const f = path.join(dir, 'projects', '-x', `${UUID}.jsonl`);
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

test('waiting status carries waitingSince (stable across re-emits) and menu options', async () => {
  const { sm, emitted, dataDir } = mgr();
  const s = inject(sm, {
    status: 'running',
    stateDetector: {
      getLastPromptText: () => 'Proceed?',
      getStatus: () => 'waiting',
      msSinceLastFeed: () => Infinity,
      getMenuOptions: () => [{ key: '1', label: 'Yes' }, { key: '2', label: 'No' }],
    },
  });
  (sm as any).applyDetectedStatus('s', 'waiting');
  const first = emitted.filter((e) => e.ev === 'session:status').at(-1)!.p;
  assert.equal(first.status, 'waiting');
  assert.ok(typeof first.waitingSince === 'number');
  assert.deepEqual(first.promptOptions, [{ key: '1', label: 'Yes' }, { key: '2', label: 'No' }]);
  await sleep(5);
  (sm as any).applyPromptUpdate('s', 'Proceed with npm test?');
  const again = emitted.filter((e) => e.ev === 'session:status').at(-1)!.p;
  assert.equal(again.waitingSince, first.waitingSince, 'same wait, same start time');
  assert.equal(sm.getSessionInfo('s')!.waitingSince, first.waitingSince);

  (sm as any).applyDetectedStatus('s', 'running');
  const after = emitted.filter((e) => e.ev === 'session:status').at(-1)!.p;
  assert.equal(after.waitingSince, undefined);
  assert.equal(s.promptOptions, undefined);
  assert.equal(sm.getSessionInfo('s')!.promptOptions, undefined);
  rmSync(dataDir, { recursive: true, force: true });
});

test('a restored session announces its Claude id and usage in session:created', async () => {
  const seed = mgr();
  const f = transcript(seed.dataDir);
  const s0 = inject(seed.sm);
  seed.sm.applyAgentMeta('s', { transcriptPath: f });
  await s0.usage.pollNow();
  const usageState = s0.usage.serialize();
  s0.usage.dispose();
  const { sm, emitted, dataDir } = mgr();

  // restoreExited: a direct session restored as an exited placeholder (no spawn).
  await sm.createSession(dataDir, 'restored', 'claude', [], 'r1', new Date().toISOString(), undefined, undefined, false, undefined, 'direct', true,
    { skipPersist: true, claudeSessionId: UUID, usage: usageState });
  const created = emitted.find((e) => e.ev === 'session:created')!.p;
  assert.equal(created.claudeSessionId, UUID);
  assert.equal(created.usage.totalTokens, 1030);
  (sm as any).sessions.get('r1').usage.dispose();
  await (sm as any).fileWatcher.stopAll();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(seed.dataDir, { recursive: true, force: true });
});

test('a repaint that changes the menu re-announces the options; an identical one does not', () => {
  const { sm, emitted, dataDir } = mgr();
  let options = [{ key: '1', label: 'Yes' }, { key: '2', label: 'No' }];
  inject(sm, {
    status: 'running',
    stateDetector: { getLastPromptText: () => 'Proceed?', getStatus: () => 'waiting', msSinceLastFeed: () => Infinity, getMenuOptions: () => options },
  });
  (sm as any).applyDetectedStatus('s', 'waiting');
  const count = () => emitted.filter((e) => e.ev === 'session:status').length;
  const before = count();
  (sm as any).refreshPromptOptions('s');
  assert.equal(count(), before, 'unchanged menu → no re-emit');
  options = [{ key: '1', label: 'Allow' }, { key: '2', label: 'Deny' }, { key: '3', label: 'Always' }];
  (sm as any).refreshPromptOptions('s');
  assert.equal(count(), before + 1);
  assert.equal(emitted.at(-1)!.p.promptOptions.length, 3);
  rmSync(dataDir, { recursive: true, force: true });
});

test('checkPromptAnswer re-reads the screen and refuses a digit the menu no longer has', () => {
  const { sm, dataDir } = mgr();
  let options: Array<{ key: string; label: string }> | undefined = [{ key: '1', label: 'Yes' }, { key: '2', label: 'No' }];
  const s = inject(sm, { status: 'waiting', stateDetector: { getMenuOptions: () => options } });
  assert.equal(sm.checkPromptAnswer('s', '2'), null);
  assert.match(sm.checkPromptAnswer('s', '3')!, /prompt changed/);
  assert.match(sm.checkPromptAnswer('s', '1; rm')!, /Invalid choice/);
  options = undefined; // the menu went away
  assert.match(sm.checkPromptAnswer('s', '1')!, /prompt changed/);
  s.status = 'running';
  assert.match(sm.checkPromptAnswer('s', '1')!, /no longer waiting/);
  assert.match(sm.checkPromptAnswer('nope', '1')!, /not found/);
  rmSync(dataDir, { recursive: true, force: true });
});
