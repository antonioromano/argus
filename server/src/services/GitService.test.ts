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

import { parseShellContext } from './GitService.js';

test('parseShellContext: branch, ahead/behind and changed files', () => {
  const out = [
    '# branch.oid 1234567890abcdef',
    '# branch.head feat/login',
    '# branch.upstream origin/feat/login',
    '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 aaa bbb src/a.ts',
    '? notes.txt',
    '',
  ].join('\n');
  assert.deepEqual(parseShellContext(out, '/r'), { root: '/r', branch: 'feat/login', detached: false, ahead: 2, behind: 1, changes: 2 });
});

test('parseShellContext: no upstream, and a detached HEAD shows the short sha', () => {
  assert.deepEqual(parseShellContext('# branch.oid abcdef1234\n# branch.head main\n', '/r'),
    { root: '/r', branch: 'main', detached: false, ahead: null, behind: null, changes: 0 });
  assert.deepEqual(parseShellContext('# branch.oid abcdef1234\n# branch.head (detached)\n', '/r'),
    { root: '/r', branch: 'abcdef1', detached: true, ahead: null, behind: null, changes: 0 });
});

import { parseNumstatZ } from './GitService.js';
import { mkdirSync } from 'fs';

test('getDiff: one staged file too big for the buffer no longer fails the whole diff', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'argus-bigdiff-'));
  try {
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
    git('init', '-q');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    mkdirSync(path.join(dir, 'sub'));
    // ~7 MB, 300k lines — over the 5 MB execFile buffer once deleted.
    writeFileSync(path.join(dir, 'sub', 'huge.json'), '{"k": "0123456789abcdef"},\n'.repeat(300_000));
    writeFileSync(path.join(dir, 'sub', 'keep.txt'), 'stays\n'); // keeps sub/ on disk after the rm
    writeFileSync(path.join(dir, 'small.txt'), 'one\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    git('rm', '-q', 'sub/huge.json');
    writeFileSync(path.join(dir, 'small.txt'), 'one\ntwo\n');
    git('add', 'small.txt');

    // Session folder is a repo subdirectory, like a shell sitting in sub/.
    const d = await new GitService().getDiff(path.join(dir, 'sub'));
    assert.equal(d.error, undefined);
    assert.deepEqual(d.oversized, ['sub/huge.json']);
    assert.match(d.staged, /\+two/, 'the small file still has its real diff');
    assert.match(d.staged, /diff --git a\/sub\/huge\.json b\/sub\/huge\.json\ndeleted file mode 100644\n--- a\/sub\/huge\.json\n\+\+\+ \/dev\/null\n/);
    assert.ok(d.staged.length < 100_000, `stub only, got ${d.staged.length} bytes`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseNumstatZ: big files and their create/delete modes', () => {
  const out = '0\t30000\tgone.json\0' + '12\t3\tsmall.ts\0' + '-\t-\timg.png\0' + '25000\t0\tnew.csv\0' +
    ' delete mode 100644 gone.json\n create mode 100755 new.csv\n';
  const { big, modes } = parseNumstatZ(out);
  assert.deepEqual(big, ['gone.json', 'new.csv']);
  assert.deepEqual(modes.get('gone.json'), { kind: 'delete', mode: '100644' });
  assert.deepEqual(modes.get('new.csv'), { kind: 'create', mode: '100755' });
});
