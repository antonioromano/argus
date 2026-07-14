import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/api.js', () => ({
  api: { findDefinition: vi.fn(), resolveImport: vi.fn() },
}));

import { api } from '../../../services/api.js';
import { wordAt, importSpecifierAt, isNavModifier, resolveDefinition } from './diffSymbolNav.js';

describe('wordAt', () => {
  it('expands the identifier around an interior offset', () => {
    const text = 'const foo = bar()';
    expect(wordAt(text, 13)?.word).toBe('bar'); // inside "bar"
    expect(wordAt(text, 7)?.word).toBe('foo'); // inside "foo"
  });

  it('keeps _ and $ as part of the identifier', () => {
    expect(wordAt('my_$var + 1', 4)?.word).toBe('my_$var');
  });

  it('resolves a word when the offset sits at its trailing edge', () => {
    // offset === text.length, left char is a word char.
    expect(wordAt('foo', 3)?.word).toBe('foo');
  });

  it('returns null when both neighbours are non-word chars', () => {
    expect(wordAt('foo  bar', 4)).toBeNull(); // between two spaces
    expect(wordAt('bar()', 4)).toBeNull(); // between "(" and ")"
  });

  it('returns null for out-of-range offsets', () => {
    expect(wordAt('foo', -1)).toBeNull();
    expect(wordAt('foo', 99)).toBeNull();
  });
});

describe('importSpecifierAt', () => {
  it('returns the specifier when the offset is inside the quotes', () => {
    const line = "import x from './foo'";
    // "./foo" occupies offsets 15..20 (inside the quotes).
    expect(importSpecifierAt(line, 17)).toBe('./foo');
  });

  it('returns null on a non-import line', () => {
    expect(importSpecifierAt("const s = './foo'", 13)).toBeNull();
  });

  it('returns null when the offset is outside every quoted range', () => {
    expect(importSpecifierAt("import x from './foo'", 2)).toBeNull();
  });
});

describe('isNavModifier', () => {
  it('is true for meta or ctrl', () => {
    expect(isNavModifier({ metaKey: true, ctrlKey: false })).toBe(true);
    expect(isNavModifier({ metaKey: false, ctrlKey: true })).toBe(true);
  });
  it('is false without a modifier', () => {
    expect(isNavModifier({ metaKey: false, ctrlKey: false })).toBe(false);
  });
});

describe('resolveDefinition', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens the first ranked location for a word', async () => {
    (api.findDefinition as ReturnType<typeof vi.fn>).mockResolvedValue({
      symbol: 'foo',
      truncated: false,
      locations: [
        { path: '/repo/b.ts', line: 5, column: 3, preview: 'function foo' },
        { path: '/repo/c.ts', line: 9, column: 1, preview: 'foo again' },
      ],
    });
    const open = vi.fn();
    await resolveDefinition({ filePath: '/repo/a.ts', word: 'foo', line: 2, specifier: null }, open);
    expect(api.findDefinition).toHaveBeenCalledWith('/repo/a.ts', 'foo', 2);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('/repo/b.ts', 5);
  });

  it('resolves an import specifier to its file at line 1', async () => {
    (api.resolveImport as ReturnType<typeof vi.fn>).mockResolvedValue({ path: '/repo/foo.ts' });
    const open = vi.fn();
    await resolveDefinition({ filePath: '/repo/a.ts', word: null, line: 4, specifier: './foo' }, open);
    expect(api.resolveImport).toHaveBeenCalledWith('/repo/a.ts', './foo');
    expect(api.findDefinition).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith('/repo/foo.ts', 1);
  });

  it('does not open when there are no locations', async () => {
    (api.findDefinition as ReturnType<typeof vi.fn>).mockResolvedValue({
      symbol: 'foo',
      truncated: false,
      locations: [],
    });
    const open = vi.fn();
    await resolveDefinition({ filePath: '/repo/a.ts', word: 'foo', line: 1, specifier: null }, open);
    expect(open).not.toHaveBeenCalled();
  });

  it('does not open when an import specifier fails to resolve', async () => {
    (api.resolveImport as ReturnType<typeof vi.fn>).mockResolvedValue({ path: null });
    const open = vi.fn();
    await resolveDefinition({ filePath: '/repo/a.ts', word: null, line: 1, specifier: './nope' }, open);
    expect(open).not.toHaveBeenCalled();
  });

  it('swallows API errors without throwing', async () => {
    (api.findDefinition as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('offline'));
    const open = vi.fn();
    await expect(
      resolveDefinition({ filePath: '/repo/a.ts', word: 'foo', line: 1, specifier: null }, open),
    ).resolves.toBeUndefined();
    expect(open).not.toHaveBeenCalled();
  });
});
