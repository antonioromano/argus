import { describe, it, expect } from 'vitest';
import { insertNewlineAt } from './compose.js';
import { composeSubmit } from './keys.js';

describe('insertNewlineAt', () => {
  it('splits the message at the caret', () => {
    expect(insertNewlineAt('abcd', 2, 2)).toEqual({ text: 'ab\ncd', caret: 3 });
  });

  it('appends when the caret sits at the end', () => {
    expect(insertNewlineAt('abc', 3, 3)).toEqual({ text: 'abc\n', caret: 4 });
  });

  it('replaces the selection, like typing would', () => {
    expect(insertNewlineAt('hello world', 5, 11)).toEqual({ text: 'hello\n', caret: 6 });
  });

  it('normalises a backwards selection', () => {
    expect(insertNewlineAt('hello world', 11, 5)).toEqual({ text: 'hello\n', caret: 6 });
  });

  // A readOnly field (dual mode) reports no usable caret, and a stale selection
  // can outlive an external edit. Appending is the safe read of intent; slicing
  // with a bogus index would silently drop text.
  it('falls back to the end when the caret is missing or out of range', () => {
    expect(insertNewlineAt('abc', null, null)).toEqual({ text: 'abc\n', caret: 4 });
    expect(insertNewlineAt('abc', 99, 99)).toEqual({ text: 'abc\n', caret: 4 });
    expect(insertNewlineAt('abc', -1, -1)).toEqual({ text: 'abc\n', caret: 4 });
  });

  it('produces newlines composeSubmit turns into the agent-visible sequence', () => {
    const { text } = insertNewlineAt('first', 5, 5);
    const sent = composeSubmit(`${text}second`);
    // ESC+CR per newline (never a bare \n, which would submit early), one final CR.
    expect(sent).toBe('first\x1b\rsecond\r');
    expect(sent.includes('\n')).toBe(false);
  });
});
