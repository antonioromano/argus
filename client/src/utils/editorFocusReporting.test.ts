import { describe, it, expect } from 'vitest';
import { nextFocusCount } from './editorFocusReporting.js';

describe('nextFocusCount', () => {
  it('increments on focus', () => {
    expect(nextFocusCount(0, 'focus')).toBe(1);
    expect(nextFocusCount(1, 'focus')).toBe(2);
  });

  it('decrements on blur', () => {
    expect(nextFocusCount(1, 'blur')).toBe(0);
    expect(nextFocusCount(2, 'blur')).toBe(1);
  });

  it('never goes negative — an extra/unmatched blur cannot leave the count stuck below zero', () => {
    expect(nextFocusCount(0, 'blur')).toBe(0);
  });
});
