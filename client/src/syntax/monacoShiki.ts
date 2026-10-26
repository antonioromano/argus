/* Monaco ← shared highlighter.
 *
 * A thin adapter instead of @shikijs/monaco: that one patches the global
 * `monaco.editor.setTheme`/`create` and only wires languages loaded when it
 * runs, which fights lazy grammars. Here each Monaco language gets a Shiki
 * tokens provider the first time a model uses it. `setTokensProvider` beats
 * Monaco's lazily-registered Monarch factories, so until the grammar lands the
 * built-in Monarch colors show (mapped to the same slots below) — no blocking.
 *
 * Tokens are slot names (`kw`, `str`, …) and the two Argus themes color them
 * from PAINT_SYNTAX, so switching theme recolors without re-tokenizing.
 */
import type * as Monaco from 'monaco-editor';
import type { StateStack } from 'shiki/textmate';

type Textmate = typeof import('shiki/textmate');
import { PAINT_SURFACES, PAINT_SYNTAX, type ThemeName } from '../tokens/paint.js';
import { CLASSIFIER_THEME, SYN_SLOTS, highlighterFor, loadLang, slotForColor, type SynSlot } from './highlighter.js';

/** Monaco language id → Shiki grammar. `typescript`/`javascript` take the
 *  JSX-aware grammars since Monaco uses one id for .ts and .tsx alike. */
export const MONACO_GRAMMARS: Record<string, string> = {
  typescript: 'tsx', javascript: 'jsx', json: 'jsonc',
  css: 'css', scss: 'scss', less: 'less', html: 'html', xml: 'xml',
  shell: 'shellscript', python: 'python', ruby: 'ruby', rust: 'rust', go: 'go', java: 'java',
  c: 'c', cpp: 'cpp', csharp: 'csharp', php: 'php', swift: 'swift', kotlin: 'kotlin', lua: 'lua',
  yaml: 'yaml', ini: 'ini', markdown: 'markdown', sql: 'sql', graphql: 'graphql', hcl: 'hcl',
  dockerfile: 'docker', dart: 'dart', scala: 'scala', elixir: 'elixir', r: 'r',
  'objective-c': 'objective-c', powershell: 'powershell', perl: 'perl', clojure: 'clojure',
};

/**
 * The Monaco language for `filePath` when langFromPath's table has none:
 * whatever Monaco itself registers for that basename/extension, so files it
 * knows (with a Monarch tokenizer at least) never open as plain text.
 */
export function registeredMonacoLanguage(monaco: typeof Monaco, filePath: string): string {
  const base = (filePath.split('/').pop() ?? '').toLowerCase();
  const dot = base.lastIndexOf('.');
  const ext = dot >= 0 ? base.slice(dot) : null;
  const match = monaco.languages.getLanguages().find(
    (l) =>
      l.filenames?.some((f) => f.toLowerCase() === base) ||
      (ext !== null && l.extensions?.some((e) => e.toLowerCase() === ext)),
  );
  return match?.id ?? 'plaintext';
}

export function monacoThemeName(theme: ThemeName): string {
  return theme === 'dark' ? 'argus-dark' : 'argus-light';
}

// Monarch token prefixes → slot, so the pre-Shiki fallback (and languages
// with no Shiki grammar here) already wear the Argus palette.
const MONARCH_RULES: [string, SynSlot][] = [
  ['keyword', 'kw'], ['tag', 'kw'], ['string', 'str'], ['attribute.name', 'str'], ['attribute.value', 'str'],
  ['regexp', 'str'], ['number', 'num'], ['constant', 'num'], ['comment', 'cm'], ['type', 'fn'],
  ['predefined', 'fn'], ['delimiter', 'pn'], ['operator', 'pn'],
];

const hex = (c: string) => c.replace('#', '');

export function monacoTheme(theme: ThemeName): Monaco.editor.IStandaloneThemeData {
  const p = PAINT_SYNTAX[theme];
  return {
    base: theme === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      ...MONARCH_RULES.map(([token, slot]) => ({ token, foreground: hex(p[slot]) })),
      // Shiki slots last so they win over any Monarch prefix they share.
      ...SYN_SLOTS.map((slot) => ({ token: slot, foreground: hex(p[slot]), ...(slot === 'cm' ? { fontStyle: 'italic' } : {}) })),
    ],
    // Dark sits on the --bg-inset well; light keeps vs's white (== --bg-2),
    // which the explorer's pre-paint background matches.
    colors: theme === 'dark'
      ? { 'editor.background': PAINT_SURFACES.dark.inset, 'editor.foreground': p.fg }
      : { 'editor.foreground': p.fg },
  };
}

class TmState implements Monaco.languages.IState {
  readonly stack: StateStack;
  constructor(stack: StateStack) {
    this.stack = stack;
  }
  clone(): TmState {
    return this;
  }
  equals(other: Monaco.languages.IState): boolean {
    return other instanceof TmState && (other.stack === this.stack || other.stack.equals(this.stack));
  }
}

// Lines past this are left unclassified, as VS Code does.
const MAX_LINE = 20_000;
const LINE_TIME_LIMIT_MS = 500;

function tokensProvider(lang: string, tm: Textmate): Monaco.languages.TokensProvider | null {
  const h = highlighterFor(lang);
  if (!h) return null;
  const grammar = h.getLanguage(lang);
  // Color index → slot, from the classifier theme the grammar encodes against.
  const slotByIndex = h.setTheme(CLASSIFIER_THEME).colorMap.map((c) => slotForColor(c) ?? '');
  return {
    getInitialState: () => new TmState(tm.INITIAL),
    tokenize(line, state) {
      const s = state as TmState;
      if (line.length > MAX_LINE) return { tokens: [{ startIndex: 0, scopes: '' }], endState: s };
      const r = grammar.tokenizeLine2(line, s.stack, LINE_TIME_LIMIT_MS);
      const tokens: Monaco.languages.IToken[] = [];
      for (let i = 0; i < r.tokens.length; i += 2) {
        const fg = tm.EncodedTokenMetadata.getForeground(r.tokens[i + 1]);
        tokens.push({ startIndex: r.tokens[i], scopes: slotByIndex[fg] ?? '' });
      }
      return { tokens, endState: new TmState(r.ruleStack) };
    },
  };
}

let attached = false;

/** Define the Argus themes and wire Shiki grammars into `monaco`. Idempotent. */
export function attachShikiToMonaco(monaco: typeof Monaco): void {
  if (attached) return;
  attached = true;
  monaco.editor.defineTheme(monacoThemeName('dark'), monacoTheme('dark'));
  monaco.editor.defineTheme(monacoThemeName('light'), monacoTheme('light'));
  for (const [monacoId, lang] of Object.entries(MONACO_GRAMMARS)) {
    monaco.languages.onLanguageEncountered(monacoId, () => {
      void Promise.all([loadLang(lang), import('shiki/textmate')]).then(([ok, tm]) => {
        const provider = ok ? tokensProvider(lang, tm) : null;
        if (provider) monaco.languages.setTokensProvider(monacoId, provider);
      });
    });
  }
}
