import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorktreeFinishStep } from '@argus/shared';
import {
  commitMessageError,
  compareUrl,
  isFinishStep,
  parsePrCreateUrl,
  removalGuard,
  runFinishSteps,
  staleDays,
  STALE_AFTER_DAYS,
  type StepExecutors,
  type StepOutcome,
} from './worktreeLifecycle.js';

function recorder(outcomes: Partial<Record<WorktreeFinishStep, StepOutcome | Error>> = {}) {
  const calls: WorktreeFinishStep[] = [];
  const exec = (step: WorktreeFinishStep) => async () => {
    calls.push(step);
    const o = outcomes[step] ?? { ok: true };
    if (o instanceof Error) throw o;
    return o;
  };
  const executors: StepExecutors = { commit: exec('commit'), push: exec('push'), pr: exec('pr') };
  return { calls, executors };
}

// ── step runner ───────────────────────────────────────────────────────────

test('runs the requested steps in commit → push → pr order, whatever order they were asked in', async () => {
  const r = recorder();
  const results = await runFinishSteps(['pr', 'commit', 'push'], r.executors);
  assert.deepEqual(r.calls, ['commit', 'push', 'pr']);
  assert.deepEqual(results.map((x) => [x.step, x.status]), [['commit', 'ok'], ['push', 'ok'], ['pr', 'ok']]);
});

test('runs only the selected steps and ignores duplicates', async () => {
  const r = recorder();
  const results = await runFinishSteps(['push', 'push'], r.executors);
  assert.deepEqual(r.calls, ['push']);
  assert.equal(results.length, 1);
});

test('stops at the first failure: later steps are skipped and never run', async () => {
  const r = recorder({ push: { ok: false, detail: 'rejected: non-fast-forward' } });
  const results = await runFinishSteps(['commit', 'push', 'pr'], r.executors);
  assert.deepEqual(r.calls, ['commit', 'push']);
  assert.deepEqual(results, [
    { step: 'commit', status: 'ok' },
    { step: 'push', status: 'failed', detail: 'rejected: non-fast-forward' },
    { step: 'pr', status: 'skipped' },
  ]);
});

test('a throwing step counts as a failure and its stderr becomes the detail', async () => {
  const err = Object.assign(new Error('Command failed'), { stderr: 'pre-commit hook failed\n' });
  const r = recorder({ commit: err });
  const results = await runFinishSteps(['commit', 'push'], r.executors);
  assert.deepEqual(r.calls, ['commit']);
  assert.deepEqual(results, [
    { step: 'commit', status: 'failed', detail: 'pre-commit hook failed' },
    { step: 'push', status: 'skipped' },
  ]);
});

test('carries the url a step produced', async () => {
  const r = recorder({ pr: { ok: true, url: 'https://github.com/o/r/pull/9' } });
  const [res] = await runFinishSteps(['pr'], r.executors);
  assert.equal(res.url, 'https://github.com/o/r/pull/9');
});

test('isFinishStep accepts only the three steps', () => {
  assert.ok(isFinishStep('commit') && isFinishStep('push') && isFinishStep('pr'));
  assert.equal(isFinishStep('merge'), false);
  assert.equal(isFinishStep(1), false);
});

// ── stale ─────────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 15);

test('a branch is stale once its last commit is at least 15 days old', () => {
  assert.equal(STALE_AFTER_DAYS, 15);
  assert.equal(staleDays(NOW - 14 * DAY, NOW), null);
  assert.equal(staleDays(NOW - 15 * DAY, NOW), 15);
  assert.equal(staleDays(NOW - 40 * DAY - 1000, NOW), 40);
});

test('an unknown or future commit time is never stale', () => {
  assert.equal(staleDays(null, NOW), null);
  assert.equal(staleDays(Number.NaN, NOW), null);
  assert.equal(staleDays(NOW + DAY, NOW), null);
});

// ── removal guard ─────────────────────────────────────────────────────────

test('removal refuses a dirty worktree even when the branch is merged', () => {
  const v = removalGuard({ dirty: true, prMerged: true, branchMerged: true, defaultBranch: 'main' });
  assert.equal(v.ok, false);
  assert.match((v as { reason: string }).reason, /uncommitted changes/);
});

test('removal refuses a branch that is neither PR-merged nor merged into the default branch', () => {
  const v = removalGuard({ dirty: false, prMerged: false, branchMerged: false, defaultBranch: 'main' });
  assert.equal(v.ok, false);
  assert.match((v as { reason: string }).reason, /not merged.*main/);
});

test('removal is allowed for a clean tree whose PR merged or whose branch is fully merged', () => {
  assert.deepEqual(removalGuard({ dirty: false, prMerged: true, branchMerged: false, defaultBranch: 'main' }), { ok: true });
  assert.deepEqual(removalGuard({ dirty: false, prMerged: false, branchMerged: true, defaultBranch: 'main' }), { ok: true });
});

// ── input validation + parsing ────────────────────────────────────────────

test('commit message must be a non-empty bounded string without NUL', () => {
  assert.equal(commitMessageError('feat: x'), null);
  assert.ok(commitMessageError(''));
  assert.ok(commitMessageError('   '));
  assert.ok(commitMessageError(undefined));
  assert.ok(commitMessageError(42));
  assert.ok(commitMessageError('a\0b'));
  assert.ok(commitMessageError('x'.repeat(10_001)));
});

test('compareUrl builds a GitHub compare link from ssh and https remotes', () => {
  const want = 'https://github.com/acme/app/compare/main...feat/x-1?expand=1';
  assert.equal(compareUrl('git@github.com:acme/app.git', 'main', 'feat/x-1'), want);
  assert.equal(compareUrl('https://github.com/acme/app.git', 'main', 'feat/x-1'), want);
  assert.equal(compareUrl('https://github.com/acme/app', 'main', 'feat/x-1'), want);
  assert.equal(compareUrl('ssh://git@github.com/acme/app.git', 'main', 'feat/x-1'), want);
  assert.equal(compareUrl('https://token@github.com/acme/app.git', 'main', 'feat/x-1'), want);
});

test('compareUrl is null for non-GitHub remotes and encodes odd branch characters', () => {
  assert.equal(compareUrl('git@gitlab.com:acme/app.git', 'main', 'x'), null);
  assert.equal(compareUrl('https://github.com.evil.io/acme/app', 'main', 'x'), null);
  assert.equal(compareUrl('git@github.com:acme/app.git', 'main', 'a#b'), 'https://github.com/acme/app/compare/main...a%23b?expand=1');
});

test('parsePrCreateUrl takes the last PR URL gh printed', () => {
  assert.equal(parsePrCreateUrl('Creating pull request…\nhttps://github.com/o/r/pull/12\n'), 'https://github.com/o/r/pull/12');
  assert.equal(parsePrCreateUrl('warning: 1 uncommitted change\n'), null);
});
