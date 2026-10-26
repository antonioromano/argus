import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateChecks,
  summarizeChecks,
  PR_FAILED_CHECKS_MAX,
  parsePrView,
  isGhUnavailable,
  PrStatusService,
  PR_PENDING_TTL_MS,
  PR_SETTLED_TTL_MS,
  PR_FINAL_TTL_MS,
  GH_UNAVAILABLE_RECHECK_MS,
  PR_VIEW_ARGS,
  prViewArgsForUrl,
  PrDiffError,
  PR_DIFF_MAX_BYTES,
  PR_DIFF_MAX_FILES,
  PR_DIFF_TIMEOUT_MS,
  type GhRunner,
  type HeadInfo,
} from './PrStatusService.js';

const run = (status: string, conclusion: string | null) => ({ __typename: 'CheckRun', status, conclusion });
const ctx = (state: string) => ({ __typename: 'StatusContext', state });

describe('aggregateChecks', () => {
  test('no checks → none', () => {
    assert.equal(aggregateChecks([]), 'none');
    assert.equal(aggregateChecks(null), 'none');
    assert.equal(aggregateChecks(undefined), 'none');
  });

  test('all completed successfully → success', () => {
    assert.equal(aggregateChecks([run('COMPLETED', 'SUCCESS'), ctx('SUCCESS')]), 'success');
  });

  test('neutral and skipped count as passing', () => {
    assert.equal(aggregateChecks([run('COMPLETED', 'SUCCESS'), run('COMPLETED', 'NEUTRAL'), run('COMPLETED', 'SKIPPED')]), 'success');
    assert.equal(aggregateChecks([run('COMPLETED', 'SKIPPED'), run('COMPLETED', 'NEUTRAL')]), 'success');
  });

  test('a running or queued check → pending', () => {
    assert.equal(aggregateChecks([run('COMPLETED', 'SUCCESS'), run('IN_PROGRESS', null)]), 'pending');
    assert.equal(aggregateChecks([run('QUEUED', '')]), 'pending');
    assert.equal(aggregateChecks([ctx('PENDING')]), 'pending');
    assert.equal(aggregateChecks([ctx('EXPECTED'), run('COMPLETED', 'SKIPPED')]), 'pending');
  });

  test('any failure wins over pending and success', () => {
    assert.equal(aggregateChecks([run('IN_PROGRESS', null), run('COMPLETED', 'FAILURE'), run('COMPLETED', 'SUCCESS')]), 'failure');
    assert.equal(aggregateChecks([run('COMPLETED', 'TIMED_OUT')]), 'failure');
    assert.equal(aggregateChecks([run('COMPLETED', 'CANCELLED')]), 'failure');
    assert.equal(aggregateChecks([run('COMPLETED', 'ACTION_REQUIRED')]), 'failure');
    assert.equal(aggregateChecks([ctx('ERROR')]), 'failure');
    assert.equal(aggregateChecks([ctx('FAILURE'), ctx('PENDING')]), 'failure');
  });
});

describe('parsePrView', () => {
  const base = { number: 42, state: 'OPEN', isDraft: false, url: 'https://github.com/o/r/pull/42', headRefName: 'feat/x', statusCheckRollup: [] };

  test('maps state and draft', () => {
    assert.deepEqual(parsePrView(JSON.stringify(base)), { number: 42, state: 'open', url: base.url, ci: 'none', branch: 'feat/x' });
    assert.equal(parsePrView(JSON.stringify({ ...base, isDraft: true }))?.state, 'draft');
    assert.equal(parsePrView(JSON.stringify({ ...base, state: 'MERGED' }))?.state, 'merged');
    assert.equal(parsePrView(JSON.stringify({ ...base, state: 'CLOSED', isDraft: true }))?.state, 'closed');
  });

  test('aggregates the rollup', () => {
    assert.equal(parsePrView(JSON.stringify({ ...base, statusCheckRollup: [run('COMPLETED', 'FAILURE')] }))?.ci, 'failure');
  });

  test('rejects junk and non-https urls', () => {
    assert.equal(parsePrView('not json'), null);
    assert.equal(parsePrView('{}'), null);
    assert.equal(parsePrView(JSON.stringify({ ...base, url: 'javascript:alert(1)' })), null);
  });
});

describe('parsePrView: title, review decision, mergeable (B3)', () => {
  const base = { number: 1, state: 'OPEN', isDraft: false, url: 'https://github.com/o/r/pull/1', headRefName: 'b' };
  test('maps the extra fields when gh reports them', () => {
    const pr = parsePrView(JSON.stringify({ ...base, title: 'Fix it', reviewDecision: 'CHANGES_REQUESTED', mergeable: 'CONFLICTING' }));
    assert.equal(pr?.title, 'Fix it');
    assert.equal(pr?.review, 'changes_requested');
    assert.equal(pr?.mergeable, 'conflicting');
    assert.equal(parsePrView(JSON.stringify({ ...base, reviewDecision: 'APPROVED', mergeable: 'MERGEABLE' }))?.review, 'approved');
    assert.equal(parsePrView(JSON.stringify({ ...base, reviewDecision: 'REVIEW_REQUIRED' }))?.review, 'review_required');
    assert.equal(parsePrView(JSON.stringify({ ...base, reviewDecision: '', mergeable: 'UNKNOWN' }))?.review, 'none');
    assert.equal(parsePrView(JSON.stringify({ ...base, mergeable: 'UNKNOWN' }))?.mergeable, 'unknown');
  });
  test('leaves them out when absent and bounds the title', () => {
    const pr = parsePrView(JSON.stringify(base))!;
    assert.equal('title' in pr || 'review' in pr || 'mergeable' in pr, false);
    assert.equal(parsePrView(JSON.stringify({ ...base, title: 'x'.repeat(1000) }))?.title?.length, 300);
  });
  test('the view asks gh for them', () => {
    assert.match(PR_VIEW_ARGS.join(' '), /title,reviewDecision,mergeable/);
  });
});

describe('summarizeChecks (C1)', () => {
  const failedRun = (name: string, extra: Record<string, unknown> = {}) => ({ ...run('COMPLETED', 'FAILURE'), name, ...extra });

  test('no checks → null', () => {
    assert.equal(summarizeChecks([]), null);
    assert.equal(summarizeChecks(undefined), null);
  });

  test('counts every outcome; skipped apart from neutral (which passes)', () => {
    const checks = summarizeChecks([
      run('COMPLETED', 'SUCCESS'), run('COMPLETED', 'NEUTRAL'), run('COMPLETED', 'SKIPPED'),
      run('IN_PROGRESS', null), ctx('PENDING'), ctx('SUCCESS'),
      failedRun('lint'), { ...ctx('ERROR'), context: 'ci/legacy', targetUrl: 'https://ci.example.com/1' },
    ]);
    assert.deepEqual(checks?.counts, { passed: 3, failed: 2, pending: 2, skipped: 1 });
    assert.deepEqual(checks?.failed, [{ name: 'lint' }, { name: 'ci/legacy', url: 'https://ci.example.com/1' }]);
  });

  test('a failed run is named with its workflow and links its details page (https only)', () => {
    const checks = summarizeChecks([
      failedRun('test', { workflowName: 'CI', detailsUrl: 'https://github.com/o/r/actions/runs/1/job/2' }),
      failedRun('build', { detailsUrl: 'javascript:alert(1)' }),
      failedRun('', {}),
    ]);
    assert.deepEqual(checks?.failed, [
      { name: 'CI / test', url: 'https://github.com/o/r/actions/runs/1/job/2' },
      { name: 'build' },
      { name: 'Unnamed check' },
    ]);
  });

  test('bounds the failed list and the names, never the counts', () => {
    const many = Array.from({ length: PR_FAILED_CHECKS_MAX + 5 }, (_, i) => failedRun(`job ${i}`));
    const checks = summarizeChecks([...many, failedRun('x'.repeat(500))])!;
    assert.equal(checks.counts.failed, PR_FAILED_CHECKS_MAX + 6);
    assert.equal(checks.failed.length, PR_FAILED_CHECKS_MAX);
    assert.equal(summarizeChecks([failedRun('x'.repeat(500))])!.failed[0].name.length, 120);
  });

  test('parsePrView carries the breakdown and the head SHA', () => {
    const base = { number: 1, state: 'OPEN', isDraft: false, url: 'https://github.com/o/r/pull/1', headRefName: 'b' };
    const pr = parsePrView(JSON.stringify({ ...base, statusCheckRollup: [failedRun('lint')], headRefOid: 'ABCDEF1234567890' }))!;
    assert.equal(pr.ci, 'failure');
    assert.deepEqual(pr.checks, { counts: { passed: 0, failed: 1, pending: 0, skipped: 0 }, failed: [{ name: 'lint' }] });
    assert.equal(pr.headSha, 'abcdef1234567890');
    assert.equal(parsePrView(JSON.stringify({ ...base, headRefOid: 'not a sha' }))?.headSha, undefined);
    assert.match(PR_VIEW_ARGS.join(' '), /headRefOid/);
  });
});

describe('parsePrView: changed lines (C2)', () => {
  const base = { number: 1, state: 'OPEN', isDraft: false, url: 'https://github.com/o/r/pull/1', headRefName: 'b' };
  test('carries additions and deletions together, only as non-negative integers', () => {
    const pr = parsePrView(JSON.stringify({ ...base, additions: 4024, deletions: 0 }))!;
    assert.equal(pr.additions, 4024);
    assert.equal(pr.deletions, 0);
    for (const bad of [{ additions: 3 }, { additions: -1, deletions: 2 }, { additions: '3', deletions: 2 }, { additions: 1.5, deletions: 2 }]) {
      const p = parsePrView(JSON.stringify({ ...base, ...bad }))!;
      assert.equal('additions' in p || 'deletions' in p, false);
    }
    assert.match(PR_VIEW_ARGS.join(' '), /additions,deletions/);
  });
});

describe('isGhUnavailable', () => {
  test('missing binary and logged-out are unavailable; no-PR is not', () => {
    assert.equal(isGhUnavailable({ code: 'ENOENT' }), true);
    assert.equal(isGhUnavailable({ code: 4 }), true);
    assert.equal(isGhUnavailable({ code: 1, stderr: 'To get started with GitHub CLI, please run:  gh auth login' }), true);
    assert.equal(isGhUnavailable({ code: 1, stderr: 'no pull requests found for branch "feat/x"' }), false);
  });
});

// ── service with a mocked runner ────────────────────────────────────────────

function prJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    number: 7, state: 'OPEN', isDraft: false, url: 'https://github.com/o/r/pull/7', headRefName: 'feat/a',
    statusCheckRollup: [run('COMPLETED', 'SUCCESS')], ...over,
  });
}

function harness(opts: {
  heads?: Record<string, HeadInfo | null>;
  defaultBranch?: string;
  gh?: (args: string[], cwd: string) => Promise<string>;
} = {}) {
  let clock = 1_000_000;
  const calls: { args: string[]; cwd: string }[] = [];
  const runGh: GhRunner = async (args, cwd) => {
    calls.push({ args, cwd });
    return opts.gh ? opts.gh(args, cwd) : prJson();
  };
  const heads = opts.heads ?? { '/repo': { root: '/repo', branch: 'feat/a' } };
  const service = new PrStatusService({
    runGh,
    headInfo: async (folder) => heads[folder] ?? null,
    defaultBranch: async () => opts.defaultBranch ?? 'main',
    now: () => clock,
  });
  return { service, calls, advance: (ms: number) => { clock += ms; } };
}

describe('PrStatusService', () => {
  test('runs gh with the json fields in the folder and parses the answer', async () => {
    const { service, calls } = harness();
    const pr = await service.forFolder('/repo');
    assert.deepEqual(pr, { number: 7, state: 'open', url: 'https://github.com/o/r/pull/7', ci: 'success', branch: 'feat/a', checks: { counts: { passed: 1, failed: 0, pending: 0, skipped: 0 }, failed: [] } });
    assert.deepEqual(calls, [{ args: PR_VIEW_ARGS, cwd: '/repo' }]);
  });

  test('skips the default branch, detached HEAD and non-repos without calling gh', async () => {
    const { service, calls } = harness({
      heads: {
        '/main': { root: '/main', branch: 'main' },
        '/detached': { root: '/detached', branch: 'HEAD' },
      },
    });
    assert.equal(await service.forFolder('/main'), null);
    assert.equal(await service.forFolder('/detached'), null);
    assert.equal(await service.forFolder('/not-a-repo'), null);
    assert.equal(calls.length, 0);
  });

  test('dedupes concurrent lookups per (gitRoot, branch)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { service, calls } = harness({
      // Two folders inside the same repo on the same branch (e.g. a subfolder session).
      heads: { '/repo': { root: '/repo', branch: 'feat/a' }, '/repo/pkg': { root: '/repo', branch: 'feat/a' } },
      gh: async () => { await gate; return prJson(); },
    });
    const a = service.forFolder('/repo');
    const b = service.forFolder('/repo/pkg');
    await new Promise((r) => setImmediate(r));
    release();
    const [pa, pb] = await Promise.all([a, b]);
    assert.equal(calls.length, 1);
    assert.deepEqual(pa, pb);
  });

  test('different branches of one repo are separate lookups', async () => {
    const { service, calls } = harness({
      heads: { '/wt1': { root: '/wt1', branch: 'feat/a' }, '/wt2': { root: '/wt1', branch: 'feat/b' } },
    });
    await service.forFolder('/wt1');
    await service.forFolder('/wt2');
    assert.equal(calls.length, 2);
  });

  test('caches a settled answer ~5 min, a pending one ~60 s', async () => {
    let json = prJson();
    const { service, calls, advance } = harness({ gh: async () => json });
    await service.forFolder('/repo');
    advance(PR_PENDING_TTL_MS + 1);
    await service.forFolder('/repo');
    assert.equal(calls.length, 1, 'settled answer still cached after 60 s');
    advance(PR_SETTLED_TTL_MS);
    json = prJson({ statusCheckRollup: [run('IN_PROGRESS', null)] });
    assert.equal((await service.forFolder('/repo'))?.ci, 'pending');
    assert.equal(calls.length, 2);
    advance(PR_PENDING_TTL_MS - 1);
    await service.forFolder('/repo');
    assert.equal(calls.length, 2, 'pending answer cached until its TTL');
    advance(2);
    json = prJson({ statusCheckRollup: [run('COMPLETED', 'FAILURE')] });
    assert.equal((await service.forFolder('/repo'))?.ci, 'failure');
    assert.equal(calls.length, 3);
  });

  test('"no pull requests found" is a cached null, not an error', async () => {
    const { service, calls, advance } = harness({
      gh: async () => { throw Object.assign(new Error('exit 1'), { code: 1, stderr: 'no pull requests found for branch "feat/a"' }); },
    });
    assert.equal(await service.forFolder('/repo'), null);
    advance(PR_PENDING_TTL_MS);
    assert.equal(await service.forFolder('/repo'), null);
    assert.equal(calls.length, 1);
  });

  test('no gh on PATH: null, one quiet note, and no retries until the recheck window', async () => {
    const info = console.info;
    const notes: unknown[] = [];
    console.info = (...a: unknown[]) => { notes.push(a); };
    try {
      const { service, calls, advance } = harness({
        heads: { '/repo': { root: '/repo', branch: 'feat/a' }, '/other': { root: '/other', branch: 'feat/z' } },
        gh: async () => { throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }); },
      });
      assert.equal(await service.forFolder('/repo'), null);
      assert.equal(await service.forFolder('/other'), null);
      advance(PR_SETTLED_TTL_MS);
      assert.equal(await service.forFolder('/other'), null);
      assert.equal(calls.length, 1, 'gh is not re-spawned while known missing');
      advance(GH_UNAVAILABLE_RECHECK_MS);
      assert.equal(await service.forFolder('/other'), null);
      assert.equal(calls.length, 2, 'looks again after the recheck window');
      assert.equal(notes.length, 1, 'logged once, not per lookup');
    } finally {
      console.info = info;
    }
  });

  test('logged-out gh is treated like a missing one', async () => {
    const info = console.info;
    console.info = () => {};
    try {
      const { service, calls } = harness({
        gh: async () => { throw Object.assign(new Error('exit 4'), { code: 4, stderr: 'gh auth login' }); },
      });
      assert.equal(await service.forFolder('/repo'), null);
      assert.equal(await service.forFolder('/repo'), null);
      assert.equal(calls.length, 1);
    } finally {
      console.info = info;
    }
  });

  test('clear() drops cached answers', async () => {
    const { service, calls } = harness();
    await service.forFolder('/repo');
    service.clear();
    await service.forFolder('/repo');
    assert.equal(calls.length, 2);
  });

  test('forUrl looks a PR up by its URL, from any folder, cached per URL', async () => {
    const url = 'https://github.com/o/other/pull/9';
    const { service, calls } = harness({ gh: async () => prJson({ number: 9, url, headRefName: 'feat/b' }) });
    const pr = await service.forUrl(url, '/hub');
    assert.deepEqual(pr, { number: 9, state: 'open', url, ci: 'success', branch: 'feat/b', checks: { counts: { passed: 1, failed: 0, pending: 0, skipped: 0 }, failed: [] } });
    await service.forUrl(url, '/elsewhere');
    assert.deepEqual(calls, [{ args: prViewArgsForUrl(url), cwd: '/hub' }]);
    assert.equal(calls[0].args[2], url);
  });

  test('a merged PR is cached for the long final TTL; an unknown mergeable state rechecks soon', async () => {
    const url = 'https://github.com/o/r/pull/7';
    let json = prJson({ state: 'MERGED' });
    const { service, calls, advance } = harness({ gh: async () => json });
    await service.forUrl(url, '/hub');
    advance(PR_SETTLED_TTL_MS + 1);
    await service.forUrl(url, '/hub');
    assert.equal(calls.length, 1, 'merged answer outlives the settled TTL');
    advance(PR_FINAL_TTL_MS);
    json = prJson({ mergeable: 'UNKNOWN' });
    await service.forUrl(url, '/hub');
    assert.equal(calls.length, 2);
    advance(PR_PENDING_TTL_MS + 1);
    await service.forUrl(url, '/hub');
    assert.equal(calls.length, 3, 'mergeability still computing → pending TTL');
  });

  test('forUrl stays quiet while gh is unavailable', async () => {
    const { service, calls } = harness({ gh: async () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); } });
    assert.equal(await service.forUrl('https://github.com/o/r/pull/1', '/hub'), null);
    assert.equal(await service.forUrl('https://github.com/o/r/pull/2', '/hub'), null);
    assert.equal(calls.length, 1);
  });
});

describe('PrStatusService.prDiff (B4)', () => {
  const url = 'https://github.com/o/r/pull/7';
  const DIFF = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n';

  function diffHarness(gh: (args: string[]) => Promise<string>) {
    const calls: { args: string[]; cwd: string; opts?: { timeoutMs?: number; maxBuffer?: number } }[] = [];
    const runGh: GhRunner = async (args, cwd, opts) => {
      calls.push({ args, cwd, opts });
      return gh(args);
    };
    const service = new PrStatusService({ runGh, headInfo: async () => null, defaultBranch: async () => 'main', now: () => 1 });
    return { service, calls };
  }

  test('runs gh pr diff on the URL in the folder, with the size limit and timeout', async () => {
    const { service, calls } = diffHarness(async () => DIFF);
    assert.deepEqual(await service.prDiff(url, '/repo'), { url, diff: DIFF });
    assert.deepEqual(calls, [{
      args: ['pr', 'diff', url, '--color', 'never'], cwd: '/repo',
      opts: { timeoutMs: PR_DIFF_TIMEOUT_MS, maxBuffer: PR_DIFF_MAX_BYTES },
    }]);
  });

  const tooBig = () => { throw Object.assign(new Error('stdout maxBuffer length exceeded'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }); };

  test('over the size limit: every changed path, from the paginated REST file list (no second patch download)', async () => {
    const { service, calls } = diffHarness(async (args) => (args[0] === 'api' ? 'a.ts\n  b/c.ts \n\n' : tooBig()));
    assert.deepEqual(await service.prDiff(url, '/repo'), {
      url, diff: '', truncated: { files: ['a.ts', 'b/c.ts'], complete: true, limitBytes: PR_DIFF_MAX_BYTES },
    });
    assert.deepEqual(calls[1].args, ['api', '--paginate', 'repos/o/r/pulls/7/files?per_page=100', '--jq', '.[].filename']);
    assert.equal(calls[1].opts?.maxBuffer, PR_DIFF_MAX_BYTES);
  });

  test('over the size limit: a list at GitHub\'s cap, or a failed one, is not complete', async () => {
    const many = Array.from({ length: PR_DIFF_MAX_FILES }, (_, i) => `f${i}.ts`).join('\n');
    const capped = diffHarness(async (args) => (args[0] === 'api' ? many : tooBig()));
    const t = (await capped.service.prDiff(url, '/repo')).truncated!;
    assert.equal(t.files.length, PR_DIFF_MAX_FILES);
    assert.equal(t.complete, false);
    const failed = diffHarness(async (args) => (args[0] === 'api' ? Promise.reject(new Error('HTTP 502')) : tooBig()));
    assert.deepEqual((await failed.service.prDiff(url, '/repo')).truncated, { files: [], complete: false, limitBytes: PR_DIFF_MAX_BYTES });
  });

  test('concurrent reads of one PR share a single gh run; a later read runs again', async () => {
    let release!: (v: string) => void;
    const { service, calls } = diffHarness(() => new Promise<string>((r) => { release = r; }));
    const a = service.prDiff(url, '/repo');
    const b = service.prDiff(url.toUpperCase().replace('HTTPS://', 'https://'), '/repo');
    assert.equal(calls.length, 1);
    release(DIFF);
    assert.equal((await a).diff, DIFF);
    assert.equal((await b).diff, DIFF);
    const c = service.prDiff(url, '/repo');
    assert.equal(calls.length, 2, 'not cached once settled');
    release(DIFF);
    await c;
  });

  test('errors carry their kind: unavailable (and backs off), timeout, failed with gh\'s message', async () => {
    const reject = async (err: unknown, kind: string, re: RegExp) => {
      const { service, calls } = diffHarness(async () => { throw err; });
      await assert.rejects(service.prDiff(url, '/repo'), (e: unknown) => e instanceof PrDiffError && e.kind === kind && re.test(e.message));
      return { service, calls };
    };
    const off = await reject(Object.assign(new Error('x'), { code: 'ENOENT' }), 'unavailable', /gh/);
    await assert.rejects(off.service.prDiff(url, '/repo'), PrDiffError);
    assert.equal(off.calls.length, 1, 'no second gh call while unavailable');
    await reject(Object.assign(new Error('x'), { killed: true, signal: 'SIGTERM' }), 'timeout', /30s/);
    await reject(Object.assign(new Error('x'), { code: 1, stderr: 'could not find pull request\nmore' }), 'failed', /^could not find pull request$/);
  });
});
