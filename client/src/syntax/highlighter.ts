/* Argus — the one syntax highlighter (roadmap B6).
 *
 * Shiki with its JavaScript regex engine: no WASM, nothing that needs
 * `unsafe-eval`, so the strict CSP in index.html is untouched. Grammars are
 * code-split and loaded on first use; the core itself is a lazy chunk too.
 *
 * Colors never come from Shiki. Every grammar is tokenized against one
 * *classifier* theme whose "colors" are just slot ids, and each token comes
 * back as a slot (`kw`, `str`, …). Consumers paint slots from the --syn-*
 * tokens (CSS) or their paint.ts mirror (Monaco), so a theme switch is a
 * repaint, never a re-tokenize, and contrast.test.ts audits every color.
 */
import type { HighlighterCore, LanguageRegistration, ThemeRegistrationRaw, ThemedToken } from 'shiki/core';

/** Syntax slots, one per --syn-* token in tokens.css. */
export const SYN_SLOTS = ['kw', 'str', 'num', 'fn', 'cm', 'pn'] as const;
export type SynSlot = (typeof SYN_SLOTS)[number];

/** One run of text on a line; `slot` absent = the surrounding text color. */
export interface SynToken {
  text: string;
  slot?: SynSlot;
}

type LangModule = { default: LanguageRegistration[] };

// Curated, not Shiki's full ~230-language bundle: each entry becomes its own
// chunk on disk, and only the ones a file/fence actually names are fetched.
const LOADERS: Record<string, () => Promise<LangModule>> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  less: () => import('shiki/langs/less.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  lua: () => import('shiki/langs/lua.mjs'),
  dart: () => import('shiki/langs/dart.mjs'),
  scala: () => import('shiki/langs/scala.mjs'),
  elixir: () => import('shiki/langs/elixir.mjs'),
  r: () => import('shiki/langs/r.mjs'),
  'objective-c': () => import('shiki/langs/objective-c.mjs'),
  powershell: () => import('shiki/langs/powershell.mjs'),
  perl: () => import('shiki/langs/perl.mjs'),
  clojure: () => import('shiki/langs/clojure.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  hcl: () => import('shiki/langs/hcl.mjs'),
  docker: () => import('shiki/langs/docker.mjs'),
  make: () => import('shiki/langs/make.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
};

const ALIASES: Record<string, string> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', node: 'javascript',
  sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript', shell: 'shellscript', console: 'shellscript',
  py: 'python', rb: 'ruby', rs: 'rust', golang: 'go', kt: 'kotlin', kts: 'kotlin',
  cs: 'csharp', 'c#': 'csharp', 'c++': 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', h: 'c',
  yml: 'yaml', md: 'markdown', mdx: 'markdown', gql: 'graphql', tf: 'hcl', terraform: 'hcl',
  dockerfile: 'docker', makefile: 'make', patch: 'diff',
  ex: 'elixir', exs: 'elixir', sc: 'scala', m: 'objective-c', mm: 'objective-c', objc: 'objective-c',
  ps1: 'powershell', psm1: 'powershell', pwsh: 'powershell', pl: 'perl', pm: 'perl',
  clj: 'clojure', cljs: 'clojure', cljc: 'clojure', edn: 'clojure',
  htm: 'html', svg: 'xml', plist: 'xml', json5: 'jsonc', conf: 'ini', properties: 'ini',
};

/** A Shiki grammar id for a fence tag / language name, or null if unsupported. */
export function resolveLang(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  if (n in LOADERS) return n;
  return ALIASES[n] ?? null;
}

/** The grammar for a file path, by basename or extension; null = plain text. */
export function langForPath(filePath: string): string | null {
  const base = (filePath.split('/').pop() ?? '').toLowerCase();
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'docker';
  if (base === 'makefile' || base === 'gnumakefile') return 'make';
  // .env files stay plain: no emphasis on what may be secrets.
  if (base === '.env' || base.startsWith('.env.')) return null;
  const dot = base.lastIndexOf('.');
  return dot > 0 || (dot === 0 && base.length > 1) ? resolveLang(base.slice(dot + 1)) : null;
}

// ── classifier theme ──────────────────────────────────────────────────────
// Slot i is "painted" #00000(i+1); unclassified text is #000000.

export const CLASSIFIER_THEME = 'argus-classifier';

const slotColor = (slot: SynSlot) => `#00000${SYN_SLOTS.indexOf(slot) + 1}`;

const SLOT_SCOPES: Record<SynSlot, string[]> = {
  cm: ['comment', 'punctuation.definition.comment', 'string.comment'],
  str: [
    'string', 'string.template', 'string.regexp', 'punctuation.definition.string', 'markup.inline.raw', 'markup.raw',
    'constant.other.symbol', 'entity.other.attribute-name', 'markup.heading',
  ],
  num: [
    'constant.numeric', 'constant.language', 'constant.character', 'constant.other',
    'support.constant', 'variable.other.constant', 'variable.other.enummember', 'keyword.other.unit',
  ],
  kw: [
    'keyword', 'storage', 'storage.type', 'storage.modifier', 'keyword.operator.new',
    'keyword.operator.expression', 'keyword.operator.logical.python', 'variable.language',
    'entity.name.tag', 'markup.bold', 'markup.italic',
  ],
  fn: [
    'entity.name.function', 'support.function', 'meta.function-call entity.name.function',
    'entity.name.type', 'entity.name.class', 'support.type', 'support.class', 'entity.other.inherited-class',
    'meta.type.annotation entity.name.type', 'entity.name.namespace', 'markup.underline.link',
    'support.type.property-name', 'meta.object-literal.key',
  ],
  pn: ['punctuation', 'meta.brace', 'keyword.operator', 'punctuation.definition.tag', 'meta.embedded punctuation'],
};

// Later rules win on equal specificity, so the generic `punctuation` and
// `keyword.operator` rules come first and their specific exceptions after.
const RULE_ORDER: SynSlot[] = ['pn', 'kw', 'fn', 'num', 'str', 'cm'];

function classifierTheme(): ThemeRegistrationRaw {
  return {
    name: CLASSIFIER_THEME,
    type: 'dark',
    settings: [
      { settings: { foreground: '#000000', background: '#ffffff' } },
      ...RULE_ORDER.map((slot) => ({ scope: SLOT_SCOPES[slot], settings: { foreground: slotColor(slot) } })),
    ],
  };
}

const COLOR_TO_SLOT = new Map<string, SynSlot>(SYN_SLOTS.map((s) => [slotColor(s), s]));

/** The slot a classifier color stands for (case-insensitive), if any. */
export function slotForColor(color: string | undefined): SynSlot | undefined {
  return color ? COLOR_TO_SLOT.get(color.toLowerCase()) : undefined;
}

// ── lazy singleton ────────────────────────────────────────────────────────

let highlighterPromise: Promise<HighlighterCore> | null = null;
let highlighter: HighlighterCore | null = null;
const langPromises = new Map<string, Promise<boolean>>();
const loadedLangs = new Set<string>();

export function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= Promise.all([import('shiki/core'), import('shiki/engine/javascript')]).then(
    async ([{ createHighlighterCore }, { createJavaScriptRegexEngine }]) => {
      const h = await createHighlighterCore({
        themes: [classifierTheme()],
        langs: [],
        // forgiving: a pattern the JS engine can't translate fails to match
        // instead of throwing — that span just stays unclassified.
        engine: createJavaScriptRegexEngine({ forgiving: true }),
      });
      highlighter = h;
      return h;
    },
  );
  return highlighterPromise;
}

/** Load a grammar (and the core on first call). Resolves false if unsupported or failed. */
export function loadLang(lang: string): Promise<boolean> {
  const loader = LOADERS[lang];
  if (!loader) return Promise.resolve(false);
  let p = langPromises.get(lang);
  if (!p) {
    p = Promise.all([getHighlighter(), loader()])
      .then(async ([h, mod]) => {
        await h.loadLanguage(mod.default);
        loadedLangs.add(lang);
        return true;
      })
      .catch((err: unknown) => {
        console.warn(`[syntax] failed to load grammar "${lang}"`, err);
        return false;
      });
    langPromises.set(lang, p);
  }
  return p;
}

/** The ready highlighter if `lang` is loaded, else null (never blocks). */
export function highlighterFor(lang: string): HighlighterCore | null {
  return highlighter && loadedLangs.has(lang) ? highlighter : null;
}

// ── tokenizing ────────────────────────────────────────────────────────────

/**
 * Longest input tokenized at all; anything bigger renders plain. Tokenizing
 * is synchronous during render: ~30k chars of TypeScript is ~100 ms, while
 * 190k was ~1 s, a visible freeze per diff side or streamed chat chunk.
 */
export const MAX_HIGHLIGHT_CHARS = 30_000;
/** Total source chars the LRU may hold; bounds memory, not entry count. */
export const CACHE_MAX_CHARS = 1_000_000;
// Insertion-ordered → oldest first; re-set on hit for LRU behavior.
const cache = new Map<string, SynToken[][]>();
let cachedChars = 0;

function toSynLine(line: ThemedToken[]): SynToken[] {
  const out: SynToken[] = [];
  for (const t of line) {
    const slot = slotForColor(t.color);
    const prev = out[out.length - 1];
    // Merge neighbours with the same slot: fewer spans / ranges downstream.
    if (prev && prev.slot === slot) prev.text += t.content;
    else out.push(slot ? { text: t.content, slot } : { text: t.content });
  }
  return out;
}

/**
 * Tokens per line for `code` in `lang`, synchronously — or null when the
 * grammar isn't loaded yet (call `loadLang` and retry) or the input is too big.
 */
export function tokenizeSync(code: string, lang: string): SynToken[][] | null {
  const h = highlighterFor(lang);
  if (!h || code.length > MAX_HIGHLIGHT_CHARS) return null;
  const key = `${lang}\0${code}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const lines = h.codeToTokensBase(code, { lang, theme: CLASSIFIER_THEME }).map(toSynLine);
  cache.set(key, lines);
  cachedChars += key.length;
  while (cachedChars > CACHE_MAX_CHARS) {
    const oldest = cache.keys().next().value as string;
    cache.delete(oldest);
    cachedChars -= oldest.length;
  }
  return lines;
}

/** Async form: loads the grammar if needed. Null = unsupported / plain text. */
export async function tokenize(code: string, lang: string | null): Promise<SynToken[][] | null> {
  if (!lang || !(await loadLang(lang))) return null;
  return tokenizeSync(code, lang);
}
