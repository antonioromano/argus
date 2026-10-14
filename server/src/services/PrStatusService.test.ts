import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateChecks,
  parsePrView,
  isGhUnavailable,
  PrStatusService,
  PR_PENDING_TTL_MS,
  PR_SETTLED_TTL_MS,
  GH_UNAVAILABLE_RECHECK_MS,
  PR_VIEW_ARGS,
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
    assert.deepEqual(pr, { number: 7, state: 'open', url: 'https://github.com/o/r/pull/7', ci: 'success', branch: 'feat/a' });
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
});
