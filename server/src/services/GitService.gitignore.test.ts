import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, realpathSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';
import os from 'os';
import path from 'path';
import { GitService, gitignoreRuleFor } from './GitService.js';

function repo(): string {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'argus-gi-')));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}
const ignored = (dir: string, p: string) => {
  try { execFileSync('git', ['check-ignore', '-q', '--', p], { cwd: dir }); return true; } catch { return false; }
};

// S9: the path was appended verbatim — a newline in it injected extra rules.
test('CR/LF and other control characters are refused (no rule injection)', async () => {
  const dir = repo();
  try {
    writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
    for (const evil of ['a.txt\n*', 'a.txt\r\n!secret', 'x\u0000y']) {
      const r = await new GitService().addToGitignore(dir, evil);
      assert.equal(r.success, false, JSON.stringify(evil));
    }
    assert.equal(readFileSync(path.join(dir, '.gitignore'), 'utf8'), 'node_modules\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the rule is anchored to the one path, not that basename everywhere', async () => {
  const dir = repo();
  try {
    mkdirSync(path.join(dir, 'sub'));
    writeFileSync(path.join(dir, '.gitignore'), 'node_modules'); // no trailing newline
    assert.deepEqual(await new GitService().addToGitignore(dir, 'sub/build.log'), { success: true });
    assert.equal(readFileSync(path.join(dir, '.gitignore'), 'utf8'), 'node_modules\n/sub/build.log\n');
    assert.equal(ignored(dir, 'sub/build.log'), true);
    assert.equal(ignored(dir, 'other/sub/build.log'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('glob characters in a name are escaped so they match literally', async () => {
  const dir = repo();
  try {
    await new GitService().addToGitignore(dir, 'a*.txt');
    assert.equal(ignored(dir, 'a*.txt'), true);
    assert.equal(ignored(dir, 'abc.txt'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gitignoreRuleFor: escapes and anchors, rejects paths outside the folder', () => {
  assert.equal(gitignoreRuleFor('/r', 'src/a.ts'), '/src/a.ts');
  assert.equal(gitignoreRuleFor('/r', '/r/src/a.ts'), '/src/a.ts');
  assert.equal(gitignoreRuleFor('/r', '#notes'), '/#notes');
  assert.equal(gitignoreRuleFor('/r', 'x[1].log'), '/x\\[1\\].log');
  assert.equal(gitignoreRuleFor('/r', '../etc/passwd'), null);
  assert.equal(gitignoreRuleFor('/r', '/r'), null);
  assert.equal(gitignoreRuleFor('/r', 'a\nb'), null);
});
