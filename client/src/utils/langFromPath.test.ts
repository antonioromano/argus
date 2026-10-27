import { describe, it, expect } from 'vitest';
import { previewKind, isMarkdownPath, isImagePath, monacoLanguageFor } from './langFromPath.js';

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

describe('isImagePath', () => {
  it('matches common image extensions case-insensitively', () => {
    expect(isImagePath('/r/logo.png')).toBe(true);
    expect(isImagePath('/r/Photo.JPG')).toBe(true);
    expect(isImagePath('/r/icon.svg')).toBe(true);
  });

  it('rejects non-image and extensionless files', () => {
    expect(isImagePath('/r/README.md')).toBe(false);
    expect(isImagePath('/r/Makefile')).toBe(false);
    expect(isImagePath('/r/archive.png.zip')).toBe(false);
  });
});

describe('monacoLanguageFor', () => {
  it('maps languages beyond the web stack (Dart, Elixir, …)', () => {
    expect(monacoLanguageFor('/app/lib/pages/game_summary_desktop.dart')).toBe('dart');
    expect(monacoLanguageFor('/app/lib/x.ex')).toBe('elixir');
    expect(monacoLanguageFor('/app/build.ps1')).toBe('powershell');
    expect(monacoLanguageFor('/app/main.tsx')).toBe('typescript');
    expect(monacoLanguageFor('/app/NOTES')).toBe('plaintext');
  });
});
