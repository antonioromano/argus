import { describe, it, expect } from 'vitest';
import type { SessionPr } from '@argus/shared';
import { prNumberOf, prRef, summarizePrStates, worstCi } from './prFormat.js';

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
