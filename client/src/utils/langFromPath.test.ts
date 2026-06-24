import { describe, it, expect } from 'vitest';
import { previewKind, isMarkdownPath } from './langFromPath.js';

describe('previewKind', () => {
  it('detects markdown variants', () => {
    expect(previewKind('/a/README.md')).toBe('markdown');
    expect(previewKind('/a/notes.mdx')).toBe('markdown');
    expect(previewKind('/a/doc.markdown')).toBe('markdown');
    expect(previewKind('/a/UPPER.MD')).toBe('markdown');
  });

  it('detects csv', () => {
    expect(previewKind('/a/data.csv')).toBe('csv');
    expect(previewKind('/a/Export.CSV')).toBe('csv');
  });

  it('returns null for non-previewable files', () => {
    expect(previewKind('/a/main.ts')).toBeNull();
    expect(previewKind('/a/style.css')).toBeNull();
    expect(previewKind('/a/Makefile')).toBeNull();
    expect(previewKind('/a/noext')).toBeNull();
  });

  it('isMarkdownPath stays markdown-only (csv is not markdown)', () => {
    expect(isMarkdownPath('/a/data.csv')).toBe(false);
    expect(isMarkdownPath('/a/README.md')).toBe(true);
  });
});
