import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGitRootResolver, resolveGitRoot } from './gitRoot.js';

test('git root lookups are cached per folder within the TTL and deduped in flight', async () => {
  let calls = 0;
  let clock = 0;
  const resolve = createGitRootResolver(async (cwd) => { calls++; return `${cwd}-root`; }, 30_000, () => clock);
  const [a, b] = await Promise.all([resolve('/r'), resolve('/r')]);
  assert.equal(a, '/r-root');
  assert.equal(b, '/r-root');
  assert.equal(calls, 1, 'concurrent callers share one lookup');
  clock = 29_999;
  await resolve('/r');
  assert.equal(calls, 1, 'still cached inside the TTL');
  clock = 30_000;
  await resolve('/r');
  assert.equal(calls, 2, 'refreshed once the TTL expires');
  await resolve('/other');
  assert.equal(calls, 3, 'cache is per folder');
});

test('a folder outside any repository resolves to itself', async () => {
  const resolve = createGitRootResolver(async () => { throw new Error('not a git repository'); });
  assert.equal(await resolve('/tmp/plain'), '/tmp/plain');
});

test('the default resolver finds this repository root via real git', async () => {
  const root = await resolveGitRoot(process.cwd());
  assert.ok(root.length > 1 && process.cwd().startsWith(root), `${root} should contain ${process.cwd()}`);
});
