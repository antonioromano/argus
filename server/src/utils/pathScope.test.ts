import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveWithinBase, resolveRelativeWithinBase } from './pathScope.js';

const BASE = '/home/u/project';

test('accepts a file directly inside the base', () => {
  assert.equal(resolveWithinBase(BASE, '/home/u/project/src/index.ts'), '/home/u/project/src/index.ts');
});

test('accepts the base itself', () => {
  assert.equal(resolveWithinBase(BASE, '/home/u/project'), '/home/u/project');
});

test('normalizes . and redundant separators', () => {
  assert.equal(resolveWithinBase(BASE, '/home/u/project/./src//a.ts'), '/home/u/project/src/a.ts');
});

test('rejects a traversal escape', () => {
  assert.equal(resolveWithinBase(BASE, '/home/u/project/../../../etc/passwd'), null);
});

test('rejects an absolute path outside the base', () => {
  assert.equal(resolveWithinBase(BASE, '/etc/passwd'), null);
});

test('rejects a sibling whose name has the base as a string prefix', () => {
  // The classic startsWith(base) bug: "/home/u/project-secrets" must NOT match
  // base "/home/u/project". The path.sep guard is what prevents this.
  assert.equal(resolveWithinBase(BASE, '/home/u/project-secrets/x'), null);
});

test('rejects relative paths', () => {
  assert.equal(resolveWithinBase(BASE, 'src/index.ts'), null);
});

test('rejects empty input', () => {
  assert.equal(resolveWithinBase(BASE, ''), null);
});

test('collapses traversal that stays within the base', () => {
  assert.equal(resolveWithinBase(BASE, '/home/u/project/src/../lib/a.ts'), '/home/u/project/lib/a.ts');
});

// resolveRelativeWithinBase — git mutation routes pass repo-relative filePaths
test('relative: accepts a normal relative file', () => {
  assert.equal(resolveRelativeWithinBase(BASE, 'src/index.ts'), `${BASE}/src/index.ts`);
});

test('relative: accepts an absolute path inside the base', () => {
  assert.equal(resolveRelativeWithinBase(BASE, `${BASE}/a.ts`), `${BASE}/a.ts`);
});

test('relative: rejects ../ traversal escape', () => {
  assert.equal(resolveRelativeWithinBase(BASE, '../../etc/passwd'), null);
});

test('relative: rejects an absolute path outside the base', () => {
  assert.equal(resolveRelativeWithinBase(BASE, '/etc/passwd'), null);
});

test('relative: rejects empty input', () => {
  assert.equal(resolveRelativeWithinBase(BASE, ''), null);
});

// --- Real-filesystem symlink-escape tests ------------------------------------
// The lexical checks above can be fooled by a symlink whose OWN path is inside
// the base but whose target escapes it. These build real fixtures on disk to
// prove the realpath re-check catches that. Each test makes its own temp base +
// outside dir and cleans them up.

function mkTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('security: rejects a symlink inside the base that points outside it', () => {
  const base = mkTmp('argus-base-');
  const outside = mkTmp('argus-outside-');
  try {
    // A symlink whose OWN path is lexically inside the base, but which resolves
    // to a directory outside the base (the classic sandbox escape).
    const link = path.join(base, 'escape');
    fs.symlinkSync(outside, link);
    assert.equal(resolveWithinBase(base, link), null);

    // Reaching a real file THROUGH the escaping symlink must also be rejected.
    const secret = path.join(outside, 'secret.txt');
    fs.writeFileSync(secret, 'top secret');
    assert.equal(resolveWithinBase(base, path.join(link, 'secret.txt')), null);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('happy path: a normal (non-symlink) file inside the base is allowed', () => {
  const base = mkTmp('argus-base-');
  try {
    const file = path.join(base, 'src.ts');
    fs.writeFileSync(file, 'ok');
    // Resolve base through symlinks too, since os.tmpdir() itself is often a
    // symlink (/var -> /private/var on macOS); the returned path is the lexical
    // resolve of the input, which callers expect.
    assert.equal(resolveWithinBase(base, file), path.resolve(file));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('edge: a not-yet-existing file whose parent is inside the base is allowed', () => {
  const base = mkTmp('argus-base-');
  try {
    // Parent dir exists and is inside the base; the file itself does not exist
    // yet (the "creating a new file" case). Must not regress to a rejection.
    const subdir = path.join(base, 'sub');
    fs.mkdirSync(subdir);
    const newFile = path.join(subdir, 'new.txt');
    assert.equal(resolveWithinBase(base, newFile), path.resolve(newFile));

    // Also the direct-child new-file case (parent === base).
    const newTop = path.join(base, 'top.txt');
    assert.equal(resolveWithinBase(base, newTop), path.resolve(newTop));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('edge: a symlinked parent pointing outside the base rejects new-file creation', () => {
  const base = mkTmp('argus-base-');
  const outside = mkTmp('argus-outside-');
  try {
    // A symlinked directory inside the base that points outside. Creating a new
    // (not-yet-existing) file inside it must be rejected — the nearest existing
    // ancestor is the symlink, and it resolves outside the base.
    const plink = path.join(base, 'pdir');
    fs.symlinkSync(outside, plink);
    assert.equal(resolveWithinBase(base, path.join(plink, 'new.txt')), null);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('relative: rejects a repo-relative path that traverses an escaping symlink', () => {
  const base = mkTmp('argus-base-');
  const outside = mkTmp('argus-outside-');
  try {
    // git mutation routes pass repo-relative paths through resolveRelativeWithinBase.
    fs.symlinkSync(outside, path.join(base, 'escape'));
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'top secret');
    assert.equal(resolveRelativeWithinBase(base, 'escape/secret.txt'), null);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('relative: a normal file inside a real base dir is still allowed', () => {
  const base = mkTmp('argus-base-');
  try {
    fs.mkdirSync(path.join(base, 'src'));
    fs.writeFileSync(path.join(base, 'src', 'index.ts'), 'ok');
    assert.equal(
      resolveRelativeWithinBase(base, 'src/index.ts'),
      path.resolve(base, 'src/index.ts'),
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
