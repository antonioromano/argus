import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  HANDOFF_DIFF_CAP,
  HANDOFF_MESSAGE_CAP,
  buildHandoffBrief,
  cleanupOldHandoffs,
  collectGitContext,
  handoffPrompt,
  readLastMessages,
  typeWhenReady,
  writeHandoffBrief,
  type GitContext,
} from './handoff.js';

const GIT: GitContext = {
  isGitRepo: true, branch: 'feat/x', status: ' M a.ts\n', statusTruncated: false,
  diffStat: ' a.ts | 2 +-\n', diff: 'diff --git a/a.ts b/a.ts\n-old\n+new\n', diffTruncated: false,
};
const BASE = { sourceName: 'api', sourceAgent: 'claude', folder: '/repo', git: GIT, messages: [], generatedAt: new Date('2026-10-15T00:00:00Z') };

function tmp(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'argus-handoff-'));
}
function git(cwd: string, ...args: string[]) {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: 'ignore' });
}

test('brief carries name, folder, branch, status, stat, diff and the note', () => {
  const md = buildHandoffBrief({ ...BASE, note: 'finish the tests' });
  for (const s of ['api', '`/repo`', 'feat/x', ' M a.ts', 'a.ts | 2 +-', '+new', '## Note from the user', 'finish the tests']) {
    assert.ok(md.includes(s), `missing ${s}`);
  }
  assert.ok(!md.includes('Diff truncated'));
});

test('brief notes a truncated diff', () => {
  const md = buildHandoffBrief({ ...BASE, git: { ...GIT, diffTruncated: true } });
  assert.match(md, /Diff truncated at 30 KB/);
});

test('brief of a non-git folder says so and has no git sections', () => {
  const md = buildHandoffBrief({ ...BASE, git: { isGitRepo: false, branch: null, status: '', statusTruncated: false, diffStat: '', diff: null, diffTruncated: false } });
  assert.match(md, /not a git repository/);
  assert.ok(!md.includes('git status --short'));
});

test('brief caps each message and handles a missing transcript', () => {
  const long = 'x'.repeat(HANDOFF_MESSAGE_CAP + 500);
  const md = buildHandoffBrief({ ...BASE, messages: [{ role: 'user', text: long }, { role: 'assistant', text: 'ok' }] });
  assert.match(md, /truncated, 500 more characters/);
  assert.ok(!md.includes('x'.repeat(HANDOFF_MESSAGE_CAP + 1)));
  assert.match(buildHandoffBrief({ ...BASE, messages: [] }), /No transcript messages/);
  // Non-Claude source: no conversation section at all.
  assert.ok(!buildHandoffBrief({ ...BASE, messages: null }).includes('Recent conversation'));
});

test('a fence outlasts backticks inside the content', () => {
  const md = buildHandoffBrief({ ...BASE, messages: [{ role: 'assistant', text: 'see ```ts\ncode\n```' }] });
  assert.ok(md.includes('````\nsee ```ts'));
});

test('prompt is one line and appends the note', () => {
  assert.equal(handoffPrompt('/d/h.md'), 'Read the handoff brief at /d/h.md and continue from it.');
  assert.equal(handoffPrompt('/d/h.md', ' fix\n  the bug '), 'Read the handoff brief at /d/h.md and continue from it: fix the bug');
});

test('collectGitContext: non-git folder', async () => {
  const dir = tmp();
  try {
    const ctx = await collectGitContext(dir, true);
    assert.equal(ctx.isGitRepo, false);
    assert.equal(ctx.diff, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('collectGitContext: status, stat, branch and a diff capped with a flag', async () => {
  const dir = tmp();
  try {
    git(dir, 'init', '-q', '-b', 'main');
    writeFileSync(path.join(dir, 'big.txt'), 'a\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'init');
    writeFileSync(path.join(dir, 'big.txt'), 'line of text that repeats\n'.repeat(4000));
    writeFileSync(path.join(dir, 'new.txt'), 'n');
    const ctx = await collectGitContext(dir, true);
    assert.equal(ctx.isGitRepo, true);
    assert.equal(ctx.branch, 'main');
    assert.match(ctx.status, /M big\.txt/);
    assert.match(ctx.status, /\?\? new\.txt/);
    assert.match(ctx.diffStat, /big\.txt/);
    assert.equal(ctx.diffTruncated, true);
    assert.ok(Buffer.byteLength(ctx.diff ?? '') <= HANDOFF_DIFF_CAP);
    const noDiff = await collectGitContext(dir, false);
    assert.equal(noDiff.diff, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('readLastMessages: last N text messages, newest file last, noise skipped, missing file ok', async () => {
  const dir = tmp();
  try {
    const line = (type: string, content: unknown) => JSON.stringify({ type, message: { content } });
    const a = path.join(dir, 'a.jsonl');
    const b = path.join(dir, 'b.jsonl');
    writeFileSync(a, [line('user', 'first'), line('assistant', [{ type: 'text', text: 'second' }])].join('\n') + '\n');
    writeFileSync(b, [
      line('user', '<command-name>/clear</command-name>'),
      line('assistant', [{ type: 'tool_use', name: 'Bash' }]),
      'not json',
      line('user', 'third'),
      line('assistant', [{ type: 'text', text: 'fourth' }]),
    ].join('\n') + '\n');
    const msgs = await readLastMessages([a, b], 3);
    assert.deepEqual(msgs.map((m) => m.text), ['second', 'third', 'fourth']);
    assert.deepEqual(await readLastMessages([path.join(dir, 'missing.jsonl')], 5), []);
    assert.deepEqual(await readLastMessages([a], 0), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('writeHandoffBrief writes a private file and rejects odd ids', async () => {
  const dir = path.join(tmp(), 'handoffs');
  try {
    const p = await writeHandoffBrief(dir, 'abc-123', '# hi');
    assert.equal(p, path.join(dir, 'abc-123.md'));
    assert.equal(readFileSync(p, 'utf8'), '# hi');
    assert.equal(statSync(p).mode & 0o777, 0o600);
    await assert.rejects(writeHandoffBrief(dir, '../x', 'y'));
  } finally { rmSync(path.dirname(dir), { recursive: true, force: true }); }
});

test('cleanupOldHandoffs removes briefs older than 7 days only', async () => {
  const dir = tmp();
  try {
    const old = path.join(dir, 'old.md');
    const fresh = path.join(dir, 'fresh.md');
    const other = path.join(dir, 'keep.txt');
    for (const f of [old, fresh, other]) writeFileSync(f, 'x');
    const tenDaysAgo = (Date.now() - 10 * 86_400_000) / 1000;
    utimesSync(old, tenDaysAgo, tenDaysAgo);
    utimesSync(other, tenDaysAgo, tenDaysAgo);
    mkdirSync(path.join(dir, 'sub.md'));
    assert.equal(await cleanupOldHandoffs(dir), 1);
    assert.equal(existsSync(old), false);
    assert.equal(existsSync(fresh), true);
    assert.equal(existsSync(other), true);
    assert.equal(await cleanupOldHandoffs(path.join(dir, 'nope')), 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('typeWhenReady waits for the shell to settle, then types text and a separate Enter', () => {
  const queue: Array<() => void> = [];
  let status = 'running';
  const writes: Array<[string, number | undefined]> = [];
  typeWhenReady('s1', 'hello', {
    status: () => status,
    write: (_id, data, pause) => writes.push([data, pause]),
    enterDelayMs: 60,
    schedule: (fn) => queue.push(fn),
  });
  queue.shift()!();
  assert.equal(writes.length, 0);
  status = 'idle';
  queue.shift()!();
  assert.deepEqual(writes, [['hello', 60], ['\r', undefined]]);
});
