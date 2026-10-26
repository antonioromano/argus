// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { composerLines, enterContinues, enterEdit, inCodeFence, indentEdit, inlineSpans, renumber, type Edit, type Line } from './composerMarkdown.js';

/** `|` marks the caret (or `|…|` a selection) in a test string. */
function at(src: string): [string, number, number] {
  const a = src.indexOf('|');
  const b = src.indexOf('|', a + 1);
  const value = src.replace(/\|/g, '');
  return [value, a, b < 0 ? a : b - 1];
}
function show(e: Edit | undefined): string | undefined {
  if (!e) return undefined;
  const { value, selStart, selEnd } = e;
  return selStart === selEnd
    ? value.slice(0, selStart) + '|' + value.slice(selStart)
    : value.slice(0, selStart) + '|' + value.slice(selStart, selEnd) + '|' + value.slice(selEnd);
}
const enter = (src: string) => show(enterEdit(...at(src)));
const tab = (src: string, out = false) => {
  const [v, s, e] = at(src);
  return show(indentEdit(v, s, e, out));
};

describe('Enter in lists', () => {
  it('continues a bullet list with the same marker', () => {
    expect(enter('- one|')).toBe('- one\n- |');
    expect(enter('* one|')).toBe('* one\n* |');
    expect(enter('  - nested|')).toBe('  - nested\n  - |');
    expect(enter('- [x] done|')).toBe('- [x] done\n- [ ] |');
  });

  it('splits an item at the caret', () => {
    expect(enter('- one| two')).toBe('- one\n- |two');
  });

  it('continues a numbered list and renumbers what follows', () => {
    expect(enter('1. one|\n2. two')).toBe('1. one\n2. |\n3. two');
    expect(enter('3) c|')).toBe('3) c\n4) |');
  });

  it('ends the list on an empty item, a nested one steps out a level', () => {
    expect(enter('- one\n- |')).toBe('- one\n|');
    expect(enter('- one\n  - |')).toBe('- one\n- |');
    expect(enter('1. one\n   1. |')).toBe('1. one\n2. |');
  });

  it('replaces a selection where Enter edits', () => {
    expect(enter('```\nfoo |bar| baz')).toBe('```\nfoo \n| baz');
    expect(enter('- one |two|')).toBe('- one \n- |');
  });

  it('sends outside lists, before the marker and with a selection there', () => {
    expect(enter('hello|')).toBeUndefined();
    expect(enter('|- one')).toBeUndefined();
    expect(enter('|hel|lo')).toBeUndefined();
    expect(enter('-not a list|')).toBeUndefined();
  });

  it('adds a line inside an open code fence, keeping the indent', () => {
    expect(enter('```ts|')).toBe('```ts\n|');
    expect(enter('```\n  x = 1|')).toBe('```\n  x = 1\n  |');
    expect(enter('```\nx\n```|')).toBeUndefined();
  });

  it('enterContinues mirrors enterEdit for the hint', () => {
    expect(enterContinues('- a', 3)).toBe(true);
    expect(enterContinues('- a', 0)).toBe(false);
    expect(enterContinues('```\nx', 5)).toBe(true);
    expect(enterContinues('plain', 5)).toBe(false);
  });
});

describe('Tab / Shift+Tab', () => {
  it('nests an item under the one above, and back out', () => {
    expect(tab('- a\n- b|')).toBe('- a\n  - b|');
    expect(tab('- a\n  - b|', true)).toBe('- a\n- b|');
    expect(tab('1. a\n2. b|')).toBe('1. a\n   1. b|');
    expect(tab('1. a\n   1. b|', true)).toBe('1. a\n2. b|');
  });

  it('indents every selected item', () => {
    expect(tab('- a\n- |b\n- c|')).toBe('- a\n  - |b\n  - c|');
  });

  it('leaves Tab to the browser (focus) when nothing can move', () => {
    expect(tab('- a|')).toBeUndefined();
    expect(tab('- a|', true)).toBeUndefined();
    expect(tab('plain|')).toBeUndefined();
  });

  it('a selection ending at the start of a line leaves that line alone', () => {
    expect(tab('- a\n|- b\n|- c')).toBe('- a\n|  - b\n|- c');
  });
});

describe('renumber', () => {
  it('counts each run up from its first item, per level', () => {
    expect(renumber('1. a\n1. b\n   1. x\n   5. y\n1. c', 0).value).toBe('1. a\n2. b\n   1. x\n   2. y\n3. c');
    expect(renumber('4. a\n9. b', 0).value).toBe('4. a\n5. b');
  });

  it('a blank line, a bullet at the same level or a fence ends a run', () => {
    expect(renumber('1. a\n\n1. b', 0).value).toBe('1. a\n\n1. b');
    expect(renumber('1. a\n- b\n1. c', 0).value).toBe('1. a\n- b\n1. c');
    expect(renumber('```\n1. a\n1. b\n```', 0).value).toBe('```\n1. a\n1. b\n```');
  });

  it('maps the caret through a longer number', () => {
    const v = Array.from({ length: 10 }, (_, i) => `${i < 9 ? i + 1 : 1}. x`).join('\n') + '\nend';
    const r = renumber(v, v.length);
    expect(r.value.endsWith('10. x\nend')).toBe(true);
    expect(r.pos).toBe(r.value.length);
  });
});

describe('highlight lines', () => {
  const text = (lines: Line[]) =>
    lines.flatMap((l) => (l.kind === 'code' ? l.lines : l.kind === 'fence' ? [l.text] : [l.spans.map((s) => s.text).join('')])).join('\n');

  it('keeps every character, in order', () => {
    const src = '# Title\n- **bold** and _it_\n1. `code` here\n> quote\n```ts\nconst x = 1;\n```\nafter *star*';
    expect(text(composerLines(src))).toBe(src);
  });

  it('marks inline bold, italic and code', () => {
    expect(inlineSpans('a **b** c')).toEqual([
      { text: 'a ' },
      { text: '**', mark: true },
      { text: 'b', bold: true },
      { text: '**', mark: true },
      { text: ' c' },
    ]);
    expect(inlineSpans('_i_')).toEqual([{ text: '_', mark: true }, { text: 'i', italic: true }, { text: '_', mark: true }]);
    expect(inlineSpans('`x*y*`')).toEqual([{ text: '`', mark: true }, { text: 'x*y*', code: true }, { text: '`', mark: true }]);
    expect(inlineSpans('**a _b_**')[2]).toEqual({ text: '_', mark: true, bold: true });
  });

  it('leaves look-alikes alone', () => {
    expect(inlineSpans('snake_case_name')).toEqual([{ text: 'snake_case_name' }]);
    expect(inlineSpans('2 * 3 * 4')).toEqual([{ text: '2 * 3 * 4' }]);
    expect(inlineSpans('** not bold **')).toEqual([{ text: '** not bold **' }]);
    expect(inlineSpans('self__cache__x')).toEqual([{ text: 'self__cache__x' }]);
    expect(inlineSpans('__init__')[1]).toEqual({ text: 'init', bold: true });
  });

  it('groups fenced code with its language, also while unclosed', () => {
    expect(composerLines('```py\nx\ny\n```')).toEqual([
      { kind: 'fence', text: '```py' },
      { kind: 'code', lang: 'py', lines: ['x', 'y'] },
      { kind: 'fence', text: '```' },
    ]);
    expect(composerLines('```\nx')).toEqual([{ kind: 'fence', text: '```' }, { kind: 'code', lang: null, lines: ['x'] }]);
    expect(inCodeFence('```\nx\n```\ny', 12)).toBe(false);
  });

  it('marks list bullets and numbers', () => {
    const [l] = composerLines('  - item');
    expect(l.kind === 'text' && l.spans.slice(0, 3)).toEqual([{ text: '  ' }, { text: '-', bullet: true }, { text: ' ' }]);
    const [n] = composerLines('12. item');
    expect(n.kind === 'text' && n.spans[0]).toEqual({ text: '12.', number: true });
  });
});
