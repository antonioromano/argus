import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { GitService, GitUnknownRefError, parseDecorations, parseGitLog, parseCommitDetail, parseNumstatFiles, parseGitRefs, parseWorktreeList } from './GitService.js';

function makeRepo(): { dir: string; git: (...a: string[]) => string } {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'argus-githistory-')));
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'ada@example.com');
  git('config', 'user.name', 'Ada');
  git('config', 'commit.gpgsign', 'false');
  return { dir, git };
}

test('history: pages newest first, with refs, and reports hasMore', async () => {
  const { dir, git } = makeRepo();
  try {
    for (let i = 1; i <= 5; i++) {
      writeFileSync(path.join(dir, 'f.txt'), `v${i}\n`);
      git('add', '.');
      git('commit', '-qm', `commit ${i}\n\nbody ${i}`);
    }
    git('tag', 'v1.0');
    const svc = new GitService();

    const first = await svc.history(dir, { skip: 0, limit: 2 });
    assert.equal(first.hasMore, true);
    assert.deepEqual(first.commits!.map((c) => c.subject), ['commit 5', 'commit 4']);
    assert.deepEqual(first.commits![0].refs, [{ kind: 'branch', name: 'main', current: true }, { kind: 'tag', name: 'v1.0' }]);
    assert.equal(first.commits![0].authorName, 'Ada');
    assert.equal(first.commits![0].parents.length, 1);
    assert.ok(first.commits![0].authorDate > 1_000_000_000_000, 'epoch ms');

    const last = await svc.history(dir, { skip: 4, limit: 2 });
    assert.equal(last.hasMore, false);
    assert.deepEqual(last.commits!.map((c) => c.subject), ['commit 1']);
    assert.deepEqual(last.commits![0].parents, []);

    const fromRef = await svc.history(dir, { skip: 0, limit: 10, ref: 'HEAD~3' });
    assert.deepEqual(fromRef.commits!.map((c) => c.subject), ['commit 2', 'commit 1']);

    await assert.rejects(svc.history(dir, { skip: 0, limit: 10, ref: 'nope' }), GitUnknownRefError);

    // A path keeps only the commits touching it.
    writeFileSync(path.join(dir, 'other.txt'), 'x\n');
    git('add', '.');
    git('commit', '-qm', 'other file');
    const onlyOther = await svc.history(dir, { skip: 0, limit: 10, path: 'other.txt' });
    assert.deepEqual(onlyOther.commits!.map((c) => c.subject), ['other file']);
    assert.equal((await svc.history(dir, { skip: 0, limit: 10, path: 'f.txt' })).commits!.length, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('history: [] on an unborn HEAD, null outside a repo', async () => {
  const { dir } = makeRepo();
  const plain = mkdtempSync(path.join(tmpdir(), 'argus-nogit-'));
  try {
    const svc = new GitService();
    assert.deepEqual(await svc.history(dir, { skip: 0, limit: 10 }), { commits: [], hasMore: false });
    assert.deepEqual(await svc.history(plain, { skip: 0, limit: 10 }), { commits: null, hasMore: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(plain, { recursive: true, force: true });
  }
});

test('commitDetail: message, files (rename + binary) and diff against the first parent', async () => {
  const { dir, git } = makeRepo();
  try {
    writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\nthree\nfour\nfive\n');
    git('add', '.');
    git('commit', '-qm', 'root');
    git('mv', 'a.txt', 'b.txt');
    writeFileSync(path.join(dir, 'b.txt'), 'one\ntwo\nthree\nfour\nfive\nsix\n');
    writeFileSync(path.join(dir, 'img.bin'), Buffer.from([0, 1, 2, 3, 0, 255]));
    git('add', '-A');
    git('commit', '-qm', 'rename and binary\n\nLonger body\nwith two lines');
    const sha = git('rev-parse', 'HEAD').trim();
    const svc = new GitService();

    const d = await svc.commitDetail(dir, sha.slice(0, 8));
    assert.ok(d);
    assert.equal(d.hash, sha);
    assert.equal(d.subject, 'rename and binary');
    assert.equal(d.message, 'rename and binary\n\nLonger body\nwith two lines');
    assert.equal(d.committerName, 'Ada');
    const byPath = new Map(d.files.map((f) => [f.path, f]));
    assert.equal(byPath.get('b.txt')?.oldPath, 'a.txt');
    assert.equal(byPath.get('b.txt')?.additions, 1);
    assert.equal(byPath.get('img.bin')?.additions, null);
    assert.match(d.diff, /rename from a\.txt/);
    assert.match(d.diff, /\+six/);
    assert.equal(d.truncated, undefined);

    // Root commit: diff against the empty tree.
    const root = await svc.commitDetail(dir, git('rev-parse', 'HEAD~1').trim());
    assert.deepEqual(root?.files.map((f) => f.path), ['a.txt']);
    assert.match(root!.diff, /new file mode/);

    assert.equal(await svc.commitDetail(dir, 'deadbeef'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('commitDetail: a merge shows what it brought in from the first parent', async () => {
  const { dir, git } = makeRepo();
  try {
    writeFileSync(path.join(dir, 'base.txt'), 'base\n');
    git('add', '.');
    git('commit', '-qm', 'base');
    git('checkout', '-qb', 'feat');
    writeFileSync(path.join(dir, 'feat.txt'), 'feat\n');
    git('add', '.');
    git('commit', '-qm', 'feat');
    git('checkout', '-q', 'main');
    writeFileSync(path.join(dir, 'main.txt'), 'main\n');
    git('add', '.');
    git('commit', '-qm', 'main');
    git('merge', '-q', '--no-ff', '-m', 'merge feat', 'feat');
    const d = await new GitService().commitDetail(dir, git('rev-parse', 'HEAD').trim());
    assert.equal(d?.parents.length, 2);
    assert.deepEqual(d?.files.map((f) => f.path), ['feat.txt']);
    assert.match(d!.diff, /^diff --git a\/feat\.txt b\/feat\.txt/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refs: local/remote branches with upstream tracking, and worktrees', async () => {
  const { dir, git } = makeRepo();
  const remote = realpathSync(mkdtempSync(path.join(tmpdir(), 'argus-remote-')));
  const wt = path.join(realpathSync(tmpdir()), `argus-wt-${process.pid}-${Date.now()}`);
  try {
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: remote });
    writeFileSync(path.join(dir, 'f.txt'), '1\n');
    git('add', '.');
    git('commit', '-qm', 'one');
    git('remote', 'add', 'origin', remote);
    git('push', '-q', '-u', 'origin', 'main');
    writeFileSync(path.join(dir, 'f.txt'), '2\n');
    git('commit', '-qam', 'two');
    git('branch', 'side');
    git('worktree', 'add', '-q', wt, 'side');

    const refs = await new GitService().refs(dir);
    assert.ok(refs);
    assert.equal(refs.root, dir);
    assert.equal(refs.current, 'main');
    const main = refs.local.find((b) => b.name === 'main')!;
    assert.equal(main.current, true);
    assert.equal(main.upstream, 'origin/main');
    assert.equal(main.ahead, 1);
    assert.equal(main.behind, 0);
    assert.equal(main.subject, 'two');
    const side = refs.local.find((b) => b.name === 'side')!;
    assert.equal(side.current, false);
    assert.equal(side.upstream, null);
    assert.equal(side.ahead, null);
    assert.equal(side.worktreePath, wt);
    assert.deepEqual(refs.remote.map((b) => b.name), ['origin/main']);
    assert.equal(refs.worktrees.length, 2);
    assert.deepEqual(refs.worktrees.map((w) => [w.branch, w.current, w.main]), [['main', true, true], ['side', false, false]]);

    assert.equal(await new GitService().refs(remote + '/nonexistent'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
    rmSync(wt, { recursive: true, force: true });
  }
});

// --- parsers on hand-written output ---

test('parseGitLog: NUL fields, empty parents/refs, tolerant of newlines between records', () => {
  const rec = (h: string, p: string, d: string, s: string) => [h, h.slice(0, 7), p, 'A', 'a@x', '1700000000', d, s].join('\0');
  const out = `${rec('a'.repeat(40), 'b'.repeat(40), 'HEAD -> refs/heads/main, tag: refs/tags/v1', 'second')}\0\n${rec('b'.repeat(40), '', '', 'first: with\ttab')}\0`;
  const commits = parseGitLog(out);
  assert.equal(commits.length, 2);
  assert.deepEqual(commits[0].refs, [{ kind: 'branch', name: 'main', current: true }, { kind: 'tag', name: 'v1' }]);
  assert.deepEqual(commits[1].parents, []);
  assert.deepEqual(commits[1].refs, []);
  assert.equal(commits[1].subject, 'first: with\ttab');
  assert.equal(commits[1].authorDate, 1_700_000_000_000);
});

test('parseDecorations: detached HEAD, remotes (minus origin/HEAD), stash dropped', () => {
  assert.deepEqual(
    parseDecorations('HEAD, refs/remotes/origin/main, refs/remotes/origin/HEAD, refs/heads/feat/x, refs/stash, tag: refs/tags/v2'),
    [{ kind: 'head', name: 'HEAD' }, { kind: 'remote', name: 'origin/main' }, { kind: 'branch', name: 'feat/x' }, { kind: 'tag', name: 'v2' }],
  );
  assert.deepEqual(parseDecorations(''), []);
});

test('parseCommitDetail: keeps the whole message and rejects garbage', () => {
  const out = ['c'.repeat(40), 'ccccccc', '', 'A', 'a@x', '1', '', 'C', 'c@x', '2', 'Subj', 'Subj\n\nBody\n\n'].join('\0') + '\0';
  const d = parseCommitDetail(out)!;
  assert.equal(d.message, 'Subj\n\nBody');
  assert.equal(d.subject, 'Subj');
  assert.equal(d.commitDate, 2000);
  assert.equal(parseCommitDetail('fatal: bad object'), null);
});

test('parseNumstatFiles: plain, rename and binary records', () => {
  const out = '\n3\t1\tsrc/a.ts\0' + '0\t0\t\0old/b.ts\0new/b.ts\0' + '-\t-\timg.png\0';
  assert.deepEqual(parseNumstatFiles(out), [
    { path: 'src/a.ts', additions: 3, deletions: 1 },
    { path: 'new/b.ts', oldPath: 'old/b.ts', additions: 0, deletions: 0 },
    { path: 'img.png', additions: null, deletions: null },
  ]);
});

test('parseGitRefs: tracking states, symrefs skipped, other worktrees noted', () => {
  const line = (...f: string[]) => f.join('\0');
  const out = [
    line('refs/heads/main', 'main', 'abc1234', '*', 'origin/main', 'ahead 2, behind 3', '1700000000', '', '/r', 'tip'),
    line('refs/heads/old', 'old', 'def5678', ' ', 'origin/old', 'gone', '1600000000', '', '', 'x'),
    line('refs/heads/sync', 'sync', '1111111', ' ', 'origin/sync', '', '1600000000', '', '/r/../wt', 'y'),
    line('refs/remotes/origin/HEAD', 'origin', 'abc1234', ' ', '', '', '1700000000', 'refs/remotes/origin/main', '', 'tip'),
    line('refs/remotes/origin/main', 'origin/main', 'abc1234', ' ', '', '', '1700000000', '', '', 'tip'),
    '',
  ].join('\n');
  const b = parseGitRefs(out, '/r');
  assert.deepEqual(b.map((x) => x.name), ['main', 'old', 'sync', 'origin/main']);
  assert.deepEqual([b[0].ahead, b[0].behind, b[0].current], [2, 3, true]);
  assert.equal(b[0].worktreePath, undefined);
  assert.deepEqual([b[1].ahead, b[1].upstreamGone], [null, true]);
  assert.deepEqual([b[2].ahead, b[2].behind, b[2].worktreePath], [0, 0, '/r/../wt']);
  assert.equal(b[3].upstream, null);
});

test('parseWorktreeList: main, detached, locked, prunable, bare', () => {
  const out = [
    'worktree /r', 'HEAD aaa', 'branch refs/heads/main', '',
    'worktree /w1', 'HEAD bbb', 'detached', 'locked reason here', '',
    'worktree /w2', 'HEAD ccc', 'branch refs/heads/feat/x', 'prunable gitdir file points to non-existent location', '',
    '',
  ].join('\0');
  const w = parseWorktreeList(out, '/w1');
  assert.deepEqual(w.map((x) => [x.path, x.branch, x.main, x.current, x.detached, x.locked, x.prunable]), [
    ['/r', 'main', true, false, false, false, false],
    ['/w1', null, false, true, true, true, false],
    ['/w2', 'feat/x', false, false, false, false, true],
  ]);
  assert.deepEqual(parseWorktreeList('', '/r'), []);
});

test('commitDetail: a subject wrapped over two lines reads the same as in the log (%s)', async () => {
  const { dir, git } = makeRepo();
  try {
    writeFileSync(path.join(dir, 'a.txt'), '1\n');
    git('add', '.');
    git('commit', '-qm', 'Fix the thing that\nbroke the other thing\n\nWhy.');
    const svc = new GitService();
    const [listed] = (await svc.history(dir, { skip: 0, limit: 1 })).commits!;
    const d = await svc.commitDetail(dir, listed.hash);
    assert.equal(d?.subject, 'Fix the thing that broke the other thing');
    assert.equal(d?.subject, listed.subject);
    assert.equal(d?.message, 'Fix the thing that\nbroke the other thing\n\nWhy.');
    // A tree is not a commit.
    assert.equal(await svc.commitDetail(dir, git('rev-parse', 'HEAD^{tree}').trim()), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
