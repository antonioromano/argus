import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { SessionManager } from './SessionManager.js';

process.env.ARGUS_PTY_BACKEND = 'tmux'; // pin backend so a built argusd binary doesn't flip the default

const fakeConfig = {
  load: async () => ({ defaultAgent: 'claude', customAgents: [], agentFlags: {} }),
  save: async () => {},
} as any;

function mgr(): SessionManager {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  (sm as any).io = { emit: () => {}, sockets: { adapter: { rooms: new Map() } } };
  (sm as any).refreshSleepPrevention = () => {};
  return sm;
}

function inject(sm: SessionManager, agentType: string): any {
  const s = {
    id: 's',
    name: 't',
    folderPath: os.tmpdir(),
    agentType,
    flags: [],
    status: 'running',
    createdAt: new Date().toISOString(),
    pty: {},
    stateDetector: { getLastPromptText: () => undefined, resize: () => {}, msSinceLastFeed: () => Infinity },
    outputBuffer: '',
    persistent: false,
    hasUserInputSinceIdle: true,
  };
  (sm as any).sessions.set('s', s);
  return s;
}

test('plain shell: a command finishing settles to idle, never promoted to done', () => {
  const sm = mgr();
  const s = inject(sm, 'shell');
  (sm as any).applyDetectedStatus('s', 'idle');
  assert.equal(s.status, 'idle');
  assert.equal(s.doneTimer, undefined, 'no done grace armed for a plain shell');
});

test('an agent session in the same state still arms the done promotion', () => {
  const sm = mgr();
  const s = inject(sm, 'claude');
  (sm as any).applyDetectedStatus('s', 'idle');
  assert.notEqual(s.doneTimer, undefined, 'claude run end arms the done grace');
  clearTimeout(s.doneTimer);
});

test('plain shell: an OSC 7 cwd report broadcasts that folder\'s git context, once per change', async () => {
  const { OscCwdParser } = await import('./oscCwd.js');
  const sm = mgr();
  const emitted: { ev: string; p: any }[] = [];
  (sm as any).io = { emit: (ev: string, p: any) => emitted.push({ ev, p }), sockets: { adapter: { rooms: new Map() } } };
  const git = { branch: 'main', detached: false, ahead: 1, behind: 0, changes: 3 };
  const asked: string[] = [];
  (sm as any).gitService = { shellContext: async (cwd: string) => { asked.push(cwd); return git; } };
  const s = inject(sm, 'shell');
  s.cwdParser = new OscCwdParser();

  // Two prompts in a row (same cwd) are coalesced into one git call.
  (sm as any).trackShellCwd(s, '\x1b]7;file://h/Users/me/repo\x07$ ');
  (sm as any).trackShellCwd(s, '\x1b]7;file://h/Users/me/repo\x07$ ');
  await new Promise((r) => setTimeout(r, 500));
  assert.deepEqual(asked, ['/Users/me/repo']);
  const ctx = emitted.filter((e) => e.ev === 'session:shellContext');
  assert.deepEqual(ctx.map((e) => e.p), [{ sessionId: 's', cwd: '/Users/me/repo', shellGit: git }]);
  assert.equal((sm as any).toSessionInfo(s).cwd, '/Users/me/repo');

  // Same cwd, same git on the next prompt: nothing new to broadcast.
  (sm as any).trackShellCwd(s, '\x1b]7;file://h/Users/me/repo\x07');
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(emitted.filter((e) => e.ev === 'session:shellContext').length, 1);
});
