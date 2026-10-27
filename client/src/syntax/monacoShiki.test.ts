// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type * as Monaco from 'monaco-editor';
import { attachShikiToMonaco, monacoTheme, monacoThemeName, registeredMonacoLanguage, MONACO_GRAMMARS } from './monacoShiki.js';
import { PAINT_SYNTAX } from '../tokens/paint.js';
import { SYN_SLOTS } from './highlighter.js';

function fakeMonaco() {
  const themes = new Map<string, Monaco.editor.IStandaloneThemeData>();
  const encountered = new Map<string, () => void>();
  const providers = new Map<string, Monaco.languages.TokensProvider>();
  const monaco = {
    editor: { defineTheme: vi.fn((name: string, data: Monaco.editor.IStandaloneThemeData) => themes.set(name, data)) },
    languages: {
      onLanguageEncountered: vi.fn((id: string, cb: () => void) => encountered.set(id, cb)),
      setTokensProvider: vi.fn((id: string, p: Monaco.languages.TokensProvider) => providers.set(id, p)),
    },
  };
  return { monaco: monaco as unknown as typeof Monaco, themes, encountered, providers };
}

describe('monacoTheme', () => {
  for (const theme of ['dark', 'light'] as const) {
    it(`${theme}: colors every slot from PAINT_SYNTAX`, () => {
      const t = monacoTheme(theme);
      for (const slot of SYN_SLOTS) {
        expect(t.rules.find((r) => r.token === slot)?.foreground).toBe(PAINT_SYNTAX[theme][slot].slice(1));
      }
      expect(t.colors['editor.foreground']).toBe(PAINT_SYNTAX[theme].fg);
    });
  }
});

describe('attachShikiToMonaco', () => {
  it('defines both themes, waits for a language, then installs a slot tokenizer', async () => {
    const { monaco, themes, encountered, providers } = fakeMonaco();
    attachShikiToMonaco(monaco);
    attachShikiToMonaco(monaco); // idempotent
    expect([...themes.keys()]).toEqual([monacoThemeName('dark'), monacoThemeName('light')]);
    expect([...encountered.keys()]).toEqual(Object.keys(MONACO_GRAMMARS));
    expect(providers.size).toBe(0); // nothing loaded until a model uses it

    encountered.get('typescript')!();
    await vi.waitFor(() => expect(providers.has('typescript')).toBe(true), { timeout: 5000 });

    const p = providers.get('typescript')!;
    const line = 'const el = <div className="a">{n + 1}</div>; // tsx';
    const r = p.tokenize(line, p.getInitialState()) as Monaco.languages.ILineTokens;
    const at = (s: string) => r.tokens.filter((t) => t.startIndex <= line.indexOf(s)).pop()?.scopes;
    expect(at('const')).toBe('kw');
    expect(at('"a"')).toBe('str');
    expect(at('1}')).toBe('num');
    expect(at('// tsx')).toBe('cm');
    // State carries across lines (inside a block comment).
    const open = p.tokenize('/* start', p.getInitialState());
    const next = p.tokenize('still comment */', open.endState) as Monaco.languages.ILineTokens;
    expect(next.tokens[0].scopes).toBe('cm');
  });
});

describe('registeredMonacoLanguage', () => {
  const monaco = {
    languages: {
      getLanguages: () => [
        { id: 'dockerfile', filenames: ['Dockerfile'] },
        { id: 'pascal', extensions: ['.pas', '.p'] },
      ],
    },
  } as unknown as typeof Monaco;

  it('falls back to what Monaco registers for the extension or basename', () => {
    expect(registeredMonacoLanguage(monaco, '/src/unit.PAS')).toBe('pascal');
    expect(registeredMonacoLanguage(monaco, '/srv/Dockerfile')).toBe('dockerfile');
    expect(registeredMonacoLanguage(monaco, '/srv/notes.unknown')).toBe('plaintext');
  });
});
