import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { AutoApprovalRule } from '@argus/shared';
import { AutoApprovalService, defaultModeFromSettings, isActiveMode, readClaudeDefaultMode, type AutoApprovalSessionView } from './AutoApprovalService.js';
import { writeFileSync } from 'fs';
import { AUTO_APPROVAL_AUDIT_MAX } from '../../constants/autoApproval.js';

let folder: string;
let alias: string;
before(() => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'argus-aas-')));
  folder = path.join(root, 'proj');
  mkdirSync(folder);
  alias = path.join(root, 'alias');
  symlinkSync(folder, alias);
});
after(() => rmSync(path.dirname(folder), { recursive: true, force: true }));


const RULE: AutoApprovalRule = { id: '00000000-0000-4000-8000-00000000000a', tool: 'Bash', bashPrefix: 'npm test', createdAt: 'x' };

function make(opts: { enabled?: boolean; session?: Partial<AutoApprovalSessionView> | null; rules?: AutoApprovalRule[] } = {}) {
  const session = opts.session === null ? undefined : { folderPath: folder, agentType: 'claude', status: 'running', ...opts.session };
  let t = 0;
  return new AutoApprovalService({
    store: { rulesFor: (f) => (f === folder ? (opts.rules ?? [RULE]) : []) },
    isEnabled: () => opts.enabled ?? true,
    getSession: (id) => (id === 's1' ? session : undefined),
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, t++)),
  });
}

const hook = (extra: Record<string, unknown> = {}) => ({
  hook_event_name: 'PreToolUse',
  permission_mode: 'default',
  tool_name: 'Bash',
  tool_input: { command: 'npm test' },
  cwd: '/somewhere/else',
  ...extra,
});

test('match → allow output, and the approval is audited', () => {
  const svc = make();
  const out = svc.decide('s1', hook());
  assert.equal(out?.hookSpecificOutput.permissionDecision, 'allow');
  const audit = svc.auditFor('s1');
  assert.equal(audit.length, 1);
  assert.deepEqual({ ...audit[0], at: undefined }, { at: undefined, sessionId: 's1', tool: 'Bash', ruleId: RULE.id, summary: 'npm test' });
});

test('no match → null and nothing audited', () => {
  const svc = make();
  assert.equal(svc.decide('s1', hook({ tool_input: { command: 'npm publish' } })), null);
  assert.equal(svc.auditFor('s1').length, 0);
});

test('global switch off, unknown/exited/non-claude session → null', () => {
  assert.equal(make({ enabled: false }).decide('s1', hook()), null);
  assert.equal(make().decide('other', hook()), null);
  assert.equal(make({ session: { status: 'exited' } }).decide('s1', hook()), null);
  assert.equal(make({ session: { agentType: 'gemini' } }).decide('s1', hook()), null);
  assert.equal(make({ rules: [] }).decide('s1', hook()), null);
});

test('only PreToolUse in default/acceptEdits mode is ever answered', () => {
  const svc = make();
  assert.ok(svc.decide('s1', hook({ permission_mode: 'acceptEdits' })));
  for (const mode of ['plan', 'bypassPermissions', 'dontAsk', undefined, 'DEFAULT']) {
    assert.equal(svc.decide('s1', hook({ permission_mode: mode })), null, String(mode));
  }
  assert.equal(svc.decide('s1', hook({ hook_event_name: 'PostToolUse' })), null);
  assert.equal(svc.decide('s1', null), null);
  assert.equal(svc.decide('s1', [hook()]), null);
});

test('the folder comes from the session table, never the hook cwd', () => {
  // Session stored through a symlinked path still resolves to the rules' realpath key.
  assert.ok(make({ session: { folderPath: alias } }).decide('s1', hook({ cwd: '/' })));
  // A session whose folder no longer exists gets no decision.
  assert.equal(make({ session: { folderPath: path.join(folder, 'gone') } }).decide('s1', hook({ cwd: folder })), null);
});

test('audit is a ring of the last N per session, newest first when merged', () => {
  const svc = make();
  for (let i = 0; i < AUTO_APPROVAL_AUDIT_MAX + 5; i++) svc.decide('s1', hook({ tool_input: { command: `npm test ${i}` } }));
  const ring = svc.auditFor('s1');
  assert.equal(ring.length, AUTO_APPROVAL_AUDIT_MAX);
  assert.equal(ring[0]!.summary, 'npm test 5');
  const merged = svc.auditForSessions(['s1']);
  assert.equal(merged[0]!.summary, `npm test ${AUTO_APPROVAL_AUDIT_MAX + 4}`);
});

test('long commands are summarized, not stored whole', () => {
  const svc = make();
  svc.decide('s1', hook({ tool_input: { command: `npm test ${'a'.repeat(500)}` } }));
  assert.ok(svc.auditFor('s1')[0]!.summary.length <= 120);
});

test('defaultModeFromSettings reads permissions.defaultMode and ignores junk', () => {
  assert.equal(defaultModeFromSettings({ permissions: { defaultMode: 'auto' } }), 'auto');
  assert.equal(defaultModeFromSettings({ permissions: {} }), null);
  assert.equal(defaultModeFromSettings({ permissions: { defaultMode: 3 } }), null);
  assert.equal(defaultModeFromSettings(null), null);
  assert.equal(defaultModeFromSettings('x'), null);
});

test('readClaudeDefaultMode reads ~/.claude/settings.json and is null when missing or broken', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'aa-home-'));
  try {
    assert.equal(readClaudeDefaultMode(home), null);
    mkdirSync(path.join(home, '.claude'));
    writeFileSync(path.join(home, '.claude', 'settings.json'), '{not json');
    assert.equal(readClaudeDefaultMode(home), null);
    writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'auto' } }));
    assert.equal(readClaudeDefaultMode(home), 'auto');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('isActiveMode: rules act only in default and acceptEdits', () => {
  assert.equal(isActiveMode('default'), true);
  assert.equal(isActiveMode('acceptEdits'), true);
  for (const m of ['auto', 'plan', 'bypassPermissions', 'dontAsk']) assert.equal(isActiveMode(m), false);
});
