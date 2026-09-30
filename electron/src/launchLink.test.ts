import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLaunchUrl } from './launchLink.js';

const H = '/Users/me';
const p = (u: string) => parseLaunchUrl(u, 'argus', H);
const newReq = (u: string) => { const r = p(u); assert.ok(r.ok && r.kind === 'new', JSON.stringify(r)); return (r as any).request; };
const err = (u: string) => { const r = p(u); assert.equal(r.ok, false, JSON.stringify(r)); return (r as any).error; };

test('new: all params map, flags keep order, ~ expands', () => {
  const r = newReq('argus://new?agent=claude&folder=~/dev/x&prompt=refresh%20dashboard&flag=--model=opus&flag=--verbose&engine=native&mode=direct&name=JarvAR&worktree=feat/x&base=main');
  assert.deepEqual(r, { agent: 'claude', folder: '/Users/me/dev/x', flags: ['--model=opus', '--verbose'], prompt: 'refresh dashboard', engine: 'native', mode: 'direct', name: 'JarvAR', worktree: 'feat/x', base: 'main' });
});

test('new: minimal request', () => {
  assert.deepEqual(newReq('argus://new?agent=claude&folder=/tmp'), { agent: 'claude', folder: '/tmp', flags: [] });
});

test('new: rejections', () => {
  assert.equal(err('argus://new?folder=/tmp'), 'missing-agent');
  assert.equal(err('argus://new?agent=claude'), 'missing-folder');
  assert.equal(err('argus://new?agent=claude&folder=relative/x'), 'bad-folder');
  assert.equal(err('argus://new?agent=claude&folder=/tmp&x=1'), 'unknown-param');
  assert.equal(err('argus://new?agent=claude&agent=codex&folder=/tmp'), 'duplicate-param');
  assert.equal(err('argus://new?agent=claude&folder=/tmp&engine=gpu'), 'bad-engine');
  assert.equal(err('argus://new?agent=claude&folder=/tmp&mode=forever'), 'bad-mode');
  assert.equal(err('argus://new?agent=claude&folder=/tmp&flag=model'), 'bad-flag-shape');
  assert.equal(err('argus://new?agent=claude&folder=/tmp&flag=--a%20b'), 'bad-flag-shape');
  assert.equal(err('argus://new?agent=claude&folder=/tmp&base=main'), 'base-without-worktree');
  assert.equal(err('argus://new?agent=claude&folder=/tmp&worktree=-x'), 'bad-worktree');
  assert.equal(err('argus://new?agent=claude&folder=/tmp&worktree=a/../b'), 'bad-worktree');
  assert.equal(err('argus://new?agent=claude&folder=/tmp&prompt=' + 'a'.repeat(9000)), 'too-long');
});

test('new: prompt rules', () => {
  assert.equal(err('argus://new?agent=claude&folder=/tmp&prompt=--dangerously-skip-permissions'), 'bad-prompt');
  assert.equal(err('argus://new?agent=claude&folder=/tmp&prompt=%20%20-p'), 'bad-prompt');
  assert.equal(err('argus://new?agent=claude&folder=/tmp&prompt=' + 'a'.repeat(4097)), 'bad-prompt');
  assert.equal(err('argus://new?agent=claude&folder=/tmp&prompt=a%E2%80%AEb'), 'bad-prompt');   // U+202E RLO
  assert.equal(err('argus://new?agent=claude&folder=/tmp&prompt=a%E2%80%8Bb'), 'bad-prompt');   // zero-width space
  assert.equal(err('argus://new?agent=claude&folder=/tmp&prompt=a%1Bb'), 'bad-prompt');         // ESC
  assert.equal(newReq('argus://new?agent=claude&folder=/tmp&prompt=line1%0Aline2').prompt, 'line1\nline2');
  assert.equal(newReq("argus://new?agent=claude&folder=/tmp&prompt=it's%20%24(rm)%20%60x%60%3B").prompt, "it's $(rm) `x`;");
});

test('new: name and folder reject control and format chars', () => {
  assert.equal(err('argus://new?agent=claude&folder=/tmp&name=a%0Ab'), 'bad-name');
  assert.equal(err('argus://new?agent=claude&folder=/tmp%E2%80%AE'), 'bad-folder');
});

test('run: id only, no params', () => {
  const r = p('argus://run/jarvar-refresh');
  assert.deepEqual(r, { ok: true, kind: 'run', launcherId: 'jarvar-refresh' });
  assert.equal(err('argus://run/Bad_Id'), 'bad-launcher-id');
  assert.equal(err('argus://run/'), 'bad-launcher-id');
  assert.equal(err('argus://run/ok?prompt=x'), 'unknown-param');
});

test('notif keeps working; wrong scheme and host rejected', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000';
  assert.deepEqual(p(`argus://notif/${id}`), { ok: true, kind: 'notif', sessionId: id });
  assert.equal(err('argus-dev://new?agent=claude&folder=/tmp'), 'wrong-scheme');
  assert.equal(err('argus://delete?x=1'), 'unknown-host');
  assert.equal(err('not a url'), 'wrong-scheme');
});
