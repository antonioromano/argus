import { describe, it, expect } from 'vitest';
import { userMarkdown } from './userMarkdown.js';

describe('userMarkdown', () => {
  it('keeps every typed newline as a line break', () => {
    expect(userMarkdown('one\ntwo\n\nthree')).toBe('one  \ntwo\n\nthree');
    expect(userMarkdown('- a \n`code`')).toBe('- a  \n`code`');
  });

  it('keeps words typed after an opening fence inside the block', () => {
    expect(userMarkdown('```then a code block\n```\nafter')).toBe('```\nthen a code block\n```\nafter');
    expect(userMarkdown('```ts\nconst a = 1;\nconst b = 2;\n```')).toBe('```ts\nconst a = 1;\nconst b = 2;\n```');
  });

  it('never touches code inside a fence, and leaves inline code alone', () => {
    expect(userMarkdown('```\na\nb\n```')).toBe('```\na\nb\n```');
    expect(userMarkdown('```x``` y\nz')).toBe('```x``` y  \nz');
  });

  it('renders the real-world prompt the composer sent (F2)', () => {
    const typed = "intro\n- one\n- here an image \n`then backticks`\n```then a code block\n```\nmore text";
    expect(userMarkdown(typed)).toBe("intro  \n- one  \n- here an image  \n`then backticks`\n```\nthen a code block\n```\nmore text");
  });
});
