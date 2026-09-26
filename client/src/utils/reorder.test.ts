import { describe, it, expect } from 'vitest';
import { insertBefore, insertionPoint } from './reorder.js';

describe('insertionPoint', () => {
  const ids = ['a', 'b', 'c'];

  it('dropping on the top half lands before that row', () => {
    expect(insertionPoint(ids, 'b', 'top')).toBe('b');
  });

  it('dropping on the bottom half lands before whatever follows', () => {
    expect(insertionPoint(ids, 'b', 'bottom')).toBe('c');
  });

  it('dropping below the last row appends', () => {
    expect(insertionPoint(ids, 'c', 'bottom')).toBeNull();
  });

  it('an unknown target appends rather than throwing', () => {
    expect(insertionPoint(ids, 'zzz', 'bottom')).toBeNull();
  });
});

describe('insertBefore', () => {
  it('moves a row up', () => {
    expect(insertBefore(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
  });

  it('moves a row down to the cursor, not one short of it', () => {
    // The bug this ordering exists to prevent: looking the index up before
    // removing 'a' would put it at index 1, landing above 'c' instead of below.
    expect(insertBefore(['a', 'b', 'c'], 'a', null)).toEqual(['b', 'c', 'a']);
    expect(insertBefore(['a', 'b', 'c', 'd'], 'a', 'd')).toEqual(['b', 'c', 'a', 'd']);
  });

  it('a null insertion point appends', () => {
    expect(insertBefore(['a', 'b'], 'a', null)).toEqual(['b', 'a']);
  });

  it('adds a row that was not in the list', () => {
    expect(insertBefore(['a', 'b'], 'new', 'b')).toEqual(['a', 'new', 'b']);
  });

  it('dropping a row onto itself is a no-op', () => {
    expect(insertBefore(['a', 'b', 'c'], 'b', 'b')).toEqual(['a', 'b', 'c']);
  });

  it('an unknown insertion point appends rather than dropping the row', () => {
    expect(insertBefore(['a', 'b'], 'a', 'zzz')).toEqual(['b', 'a']);
  });
});
