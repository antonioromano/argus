import { describe, it, expect } from 'vitest';
import type { SessionPr } from '@argus/shared';
import { ciSummary, prChecksUrl, prNumberOf, prRef, prTone, summarizePrStates, worstCi } from './prFormat.js';

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

describe('ciSummary (C1)', () => {
  const counts = (passed: number, failed: number, pending: number, skipped: number) => ({ counts: { passed, failed, pending, skipped }, failed: [] });
  it('names failed and pending checks, else says everything passed', () => {
    expect(ciSummary({ ...pr('open', 'failure'), checks: counts(3, 1, 2, 0) })).toBe('CI: 1 failed, 2 pending');
    expect(ciSummary({ ...pr('open', 'pending'), checks: counts(3, 0, 2, 0) })).toBe('CI: 2 pending');
    expect(ciSummary({ ...pr('open', 'success'), checks: counts(3, 0, 0, 0) })).toBe('CI: all checks passed');
    expect(ciSummary({ ...pr('open', 'success'), checks: counts(3, 0, 0, 2) })).toBe('CI: all checks passed (2 skipped)');
  });
  it('falls back to the aggregate without counts', () => {
    expect(ciSummary(pr('open', 'none'))).toBe('CI: no checks');
    expect(ciSummary(pr('open', 'failure'))).toBe('CI: checks failing');
  });
  it('links the checks tab', () => {
    expect(prChecksUrl('https://github.com/o/r/pull/1')).toBe('https://github.com/o/r/pull/1/checks');
  });
});
