import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { GitService } from './GitService.js';

function makeTempRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'argus-gitservice-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  writeFileSync(path.join(dir, 'file.txt'), 'hello\n');
  execFileSync('git', ['add', 'file.txt'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

test('getBlame evicts the oldest cache entry once BLAME_CACHE_MAX_ENTRIES is exceeded', async () => {
  const dir = makeTempRepo();
  try {
    const git = new GitService();
    const cache: Map<string, unknown> = (git as any).blameCache;

    // Seed the cache at the cap with synthetic entries (insertion order matters —
    // the eviction loop must remove the oldest one, not an arbitrary one).
    for (let i = 0; i < 500; i++) {
      cache.set(`synthetic-${i}`, { data: { lines: [] }, headSha: 'fake' });
    }
    assert.equal(cache.size, 500);

    const result = await git.getBlame(dir, 'file.txt');
    assert.equal(result.error, undefined);

    assert.equal(cache.size, 500, 'cache must stay capped at BLAME_CACHE_MAX_ENTRIES');
    assert.equal(cache.has('synthetic-0'), false, 'oldest (first-inserted) entry must be evicted');
    assert.equal(cache.has('synthetic-1'), true, 'entries newer than the evicted one must survive');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
