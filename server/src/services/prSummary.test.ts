import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionPr } from '@argus/shared';
import { summarizePrs } from './prSummary.js';

const pr = (number: number, over: Partial<SessionPr> = {}): SessionPr => ({
  number, state: 'open', url: `https://github.com/o/r/pull/${number}`, ci: 'success', branch: `b${number}`,
  mergeable: 'mergeable', review: 'none', ...over,
});

test('summarizePrs: no PR, or only closed ones → null', () => {
  assert.equal(summarizePrs([]), null);
  assert.equal(summarizePrs([pr(1, { state: 'closed' })]), null);
});

test('summarizePrs: closed PRs are left out of the count and the list', () => {
  const s = summarizePrs([pr(1, { state: 'closed' }), pr(2), pr(3, { state: 'merged' })]);
  assert.equal(s?.count, 2);
  assert.deepEqual(s?.prs.map((i) => i.number), [2, 3]);
});

test('summarizePrs: the tone is the most action-needing one — blocked → pending → ready → draft → merged', () => {
  const blocked = pr(1, { ci: 'failure' });
  const conflicting = pr(2, { mergeable: 'conflicting' });
  const pending = pr(3, { ci: 'pending' });
  const ready = pr(4);
  const draft = pr(5, { state: 'draft' });
  const merged = pr(6, { state: 'merged' });
  assert.equal(summarizePrs([merged, draft, ready, pending, blocked])?.tone, 'blocked');
  assert.equal(summarizePrs([merged, conflicting])?.tone, 'blocked');
  assert.equal(summarizePrs([merged, draft, ready, pending])?.tone, 'pending');
  assert.equal(summarizePrs([merged, draft, ready])?.tone, 'ready');
  assert.equal(summarizePrs([merged, draft])?.tone, 'draft');
  assert.equal(summarizePrs([merged, pr(7, { state: 'closed', ci: 'failure' })])?.tone, 'merged');
});

test('summarizePrs: each item carries its own tone and title', () => {
  const s = summarizePrs([pr(1, { title: 'Fix it', review: 'review_required' })]);
  assert.deepEqual(s?.prs, [{ url: 'https://github.com/o/r/pull/1', number: 1, state: 'open', tone: 'pending', title: 'Fix it' }]);
});
