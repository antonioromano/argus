import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, utimesSync, rmSync, realpathSync } from 'fs';
import os from 'os';
import path from 'path';
import { UNTITLED, conversationDirs, listClaudeConversations, projectDirName } from './claudeConversations.js';

const ID = (n: number) => `0000000${n}-1111-4222-8333-444444444444`;
const line = (o: unknown) => JSON.stringify(o) + '\n';
const user = (text: string, extra: Record<string, unknown> = {}) =>
  line({ type: 'user', uuid: 'u', message: { role: 'user', content: text }, ...extra });

function setup() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'argus-convs-')));
  const dir = path.join(root, projectDirName('/Users/me/repo'));
  mkdirSync(dir);
  const write = (n: number, body: string, mtimeSec: number) => {
    const f = path.join(dir, `${ID(n)}.jsonl`);
    writeFileSync(f, body);
    utimesSync(f, mtimeSec, mtimeSec);
    return f;
  };
  return { root, dir, write, done: () => rmSync(root, { recursive: true, force: true }) };
}

test('projectDirName matches Claude Code’s folder naming', () => {
  assert.equal(projectDirName('/Users/me/my repo/.claude/worktrees/x'), '-Users-me-my-repo--claude-worktrees-x');
});

test('lists conversations newest first, titled by custom title, last prompt, then first prompt', async () => {
  const { root, dir, write, done } = setup();
  write(1, user('<command-name>/model</command-name><command-args>opus</command-args>') + user('first question') + line({ type: 'custom-title', customTitle: 'Old name' }) + line({ type: 'custom-title', customTitle: '[FLEX-1] Renamed' }), 1000);
  write(2, user('hello there') + line({ type: 'last-prompt', lastPrompt: 'the   latest\nprompt' }), 3000);
  write(3, user('<system-reminder>x</system-reminder>', { isMeta: true }) + user('only the first prompt'), 2000);
  write(4, line({ type: 'file-history-snapshot' }), 4000); // no user turn: not offered
  writeFileSync(path.join(dir, 'notes.jsonl'), user('not a conversation file'));

  const out = await listClaudeConversations([dir, dir], { roots: [root], currentId: ID(2) });
  assert.deepEqual(out, [
    { id: ID(2), title: 'the latest prompt', updatedAt: 3_000_000, current: true },
    { id: ID(3), title: 'only the first prompt', updatedAt: 2_000_000 },
    { id: ID(1), title: '[FLEX-1] Renamed', updatedAt: 1_000_000 },
  ]);
  assert.equal((await listClaudeConversations([dir], { roots: [root], limit: 1 })).length, 1);
  done();
});

test('never opens a file outside the transcript roots, and a missing dir is empty', async () => {
  const { root, dir, done } = setup();
  const outside = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'argus-outside-')));
  const secret = path.join(outside, 'secret.jsonl');
  writeFileSync(secret, user('secret'));
  symlinkSync(secret, path.join(dir, `${ID(9)}.jsonl`));
  assert.deepEqual(await listClaudeConversations([dir], { roots: [root] }), []);
  assert.deepEqual(await listClaudeConversations([path.join(root, 'nope')], { roots: [root] }), []);
  rmSync(outside, { recursive: true, force: true });
  done();
});

test('a conversation whose opening prompt is longer than the head read is kept, untitled', async () => {
  const { root, dir, write, done } = setup();
  write(5, user('x'.repeat(200 * 1024)) + line({ type: 'assistant', uuid: 'a' }), 1000);
  assert.deepEqual(await listClaudeConversations([dir], { roots: [root] }), [{ id: ID(5), title: UNTITLED, updatedAt: 1_000_000 }]);
  done();
});

test('dirs outside the transcript roots are never listed', async () => {
  const { root, done } = setup();
  const outside = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'argus-outside-')));
  writeFileSync(path.join(outside, `${ID(7)}.jsonl`), user('elsewhere'));
  assert.deepEqual(await listClaudeConversations([outside], { roots: [root] }), []);
  rmSync(outside, { recursive: true, force: true });
  done();
});

test('conversationDirs: the current transcript dir first, then the work root under each root', () => {
  const roots = ['/home/u/.config/claude/projects', '/home/u/.claude/projects'];
  assert.deepEqual(conversationDirs('/home/u/.claude/projects/-short-x/abc.jsonl', '/repo/.claude/worktrees/w', roots), [
    '/home/u/.claude/projects/-short-x',
    '/home/u/.config/claude/projects/-repo--claude-worktrees-w',
    '/home/u/.claude/projects/-repo--claude-worktrees-w',
  ]);
  assert.deepEqual(conversationDirs(undefined, '/repo', roots.slice(1)), ['/home/u/.claude/projects/-repo']);
});
