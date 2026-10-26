// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { langForPath, resolveLang, slotForColor, tokenize, tokenizeSync, loadLang, SYN_SLOTS, MAX_HIGHLIGHT_CHARS } from './highlighter.js';

function slotOf(lines: { text: string; slot?: string }[][], text: string): string | undefined {
  for (const line of lines) for (const t of line) if (t.text.trim() === text) return t.slot;
  throw new Error(`no token "${text}" in ${JSON.stringify(lines)}`);
}

describe('language resolution', () => {
  it('maps fence tags and aliases to grammar ids', () => {
    expect(resolveLang('ts')).toBe('typescript');
    expect(resolveLang('TSX')).toBe('tsx');
    expect(resolveLang('bash')).toBe('shellscript');
    expect(resolveLang('yml')).toBe('yaml');
    expect(resolveLang('brainfuck')).toBeNull();
    expect(resolveLang('')).toBeNull();
    expect(resolveLang(undefined)).toBeNull();
  });

  it('maps file paths by extension or basename', () => {
    expect(langForPath('src/app/App.tsx')).toBe('tsx');
    expect(langForPath('server/index.ts')).toBe('typescript');
    expect(langForPath('/a/b/Dockerfile')).toBe('docker');
    expect(langForPath('Makefile')).toBe('make');
    expect(langForPath('README')).toBeNull();
    expect(langForPath('notes.unknownext')).toBeNull();
  });

  it('never highlights .env files', () => {
    expect(langForPath('.env')).toBeNull();
    expect(langForPath('config/.env.local')).toBeNull();
  });
});

describe('classifier colors', () => {
  it('round-trip every slot', () => {
    SYN_SLOTS.forEach((slot, i) => expect(slotForColor(`#00000${i + 1}`)).toBe(slot));
    expect(slotForColor('#000000')).toBeUndefined();
    expect(slotForColor(undefined)).toBeUndefined();
  });
});

describe('tokenize', () => {
  it('returns null synchronously until the grammar is loaded', () => {
    expect(tokenizeSync('const a = 1', 'go')).toBeNull();
  });

  it('classifies TypeScript into slots', async () => {
    const code = "// hi\nexport function add(a: number): number {\n  return a + 42 + 'x'.length;\n}";
    const lines = await tokenize(code, 'typescript');
    expect(lines).not.toBeNull();
    expect(lines!).toHaveLength(4);
    expect(slotOf(lines!, '// hi')).toBe('cm');
    expect(slotOf(lines!, 'export')).toBe('kw');
    expect(slotOf(lines!, 'add')).toBe('fn');
    expect(slotOf(lines!, '42')).toBe('num');
    expect(slotOf(lines!, "'x'")).toBe('str');
    // Lines reassemble to the source exactly.
    expect(lines!.map((l) => l.map((t) => t.text).join('')).join('\n')).toBe(code);
  });

  it('classifies Dart', async () => {
    const lines = await tokenize("class A extends B {\n  final int n = 1; // x\n}", 'dart');
    expect(slotOf(lines!, 'class')).toBe('kw');
    expect(slotOf(lines!, '1')).toBe('num');
    expect(slotOf(lines!, '// x')).toBe('cm');
    expect(langForPath('lib/pages/game_summary.dart')).toBe('dart');
  });

  it('is synchronous and cached once loaded', async () => {
    await loadLang('python');
    const a = tokenizeSync('def f(): pass', 'python');
    expect(a).not.toBeNull();
    expect(tokenizeSync('def f(): pass', 'python')).toBe(a);
  });

  it('leaves inputs over the synchronous cap plain', async () => {
    await loadLang('json');
    const big = `[${'1,'.repeat(MAX_HIGHLIGHT_CHARS / 2)}1]`;
    expect(big.length).toBeGreaterThan(MAX_HIGHLIGHT_CHARS);
    expect(tokenizeSync(big, 'json')).toBeNull();
    expect(tokenizeSync('[1]', 'json')).not.toBeNull();
  });

  it('returns null for unsupported languages', async () => {
    expect(await tokenize('x', null)).toBeNull();
    expect(await loadLang('nope')).toBe(false);
  });
});
