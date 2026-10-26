import { describe, it, expect } from 'vitest';
import type { SessionPr } from '@argus/shared';
import { prNumberOf, prRef, prTone, summarizePrStates, worstCi } from './prFormat.js';

const pr = (state: SessionPr['state'], ci: SessionPr['ci']): SessionPr => ({ number: 1, state, ci, url: 'https://github.com/o/r/pull/1', branch: 'b' });

describe('worstCi', () => {
  it('ranks failure over pending over success, ignoring merged/closed PRs', () => {
    expect(worstCi([pr('open', 'success'), pr('draft', 'pending')])).toBe('pending');
    expect(worstCi([pr('open', 'pending'), pr('open', 'failure'), pr('open', 'success')])).toBe('failure');
    expect(worstCi([pr('merged', 'failure'), pr('closed', 'failure'), pr('open', 'success')])).toBe('success');
    expect(worstCi([pr('open', 'none'), null])).toBe('none');
    expect(worstCi([])).toBe('none');
  });
});

describe('summarizePrStates', () => {
  it('counts per state in lifecycle order, unreadable ones last', () => {
    expect(summarizePrStates([pr('merged', 'none'), pr('open', 'success'), null, pr('open', 'none')])).toBe('2 open, 1 merged, 1 unknown');
    expect(summarizePrStates([])).toBe('');
  });
});

describe('prRef / prNumberOf', () => {
  it('formats owner/repo#n from a PR URL', () => {
    expect(prNumberOf('https://github.com/o/r/pull/42')).toBe(42);
    expect(prRef('https://github.com/o/r/pull/42')).toBe('o/r#42');
    expect(prRef('https://example.com/x/pull/3', 3)).toBe('#3');
  });
});

describe('prTone', () => {
  const open = (over: Partial<SessionPr>): SessionPr => ({ number: 1, state: 'open', url: 'https://github.com/o/r/pull/1', ci: 'success', branch: 'b', ...over });
  it('merged, closed and draft keep their own tone', () => {
    expect(prTone(open({ state: 'merged' }))).toBe('merged');
    expect(prTone(open({ state: 'closed', ci: 'failure' }))).toBe('closed');
    expect(prTone(open({ state: 'draft', mergeable: 'conflicting', ci: 'failure' }))).toBe('draft');
  });
  it('an open PR is blocked by conflicts or failing checks', () => {
    expect(prTone(open({ mergeable: 'conflicting', ci: 'pending' }))).toBe('blocked');
    expect(prTone(open({ ci: 'failure', mergeable: 'mergeable' }))).toBe('blocked');
  });
  it('ready only once checks passed (or none), it is mergeable and no review is outstanding', () => {
    expect(prTone(open({ mergeable: 'mergeable' }))).toBe('ready');
    expect(prTone(open({ mergeable: 'mergeable', ci: 'none', review: 'approved' }))).toBe('ready');
    expect(prTone(open({ mergeable: 'mergeable', review: 'none' }))).toBe('ready');
  });
  it('otherwise pending: checks running, review asked for, mergeability unknown', () => {
    expect(prTone(open({ mergeable: 'mergeable', ci: 'pending' }))).toBe('pending');
    expect(prTone(open({ mergeable: 'mergeable', review: 'review_required' }))).toBe('pending');
    expect(prTone(open({ mergeable: 'mergeable', review: 'changes_requested' }))).toBe('pending');
    expect(prTone(open({ mergeable: 'unknown' }))).toBe('pending');
    expect(prTone(open({}))).toBe('pending');
  });
});
