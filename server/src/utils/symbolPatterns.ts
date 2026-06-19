// Heuristic, language-aware definition patterns for symbol navigation. No AST /
// LSP — these are regexes run by ripgrep, then re-tested in Node to rank hits.
// Ordered strongest-first: earlier patterns are higher-confidence definitions.

export type SymbolKind = 'function' | 'class' | 'type' | 'variable' | 'method' | 'unknown';

export interface DefinitionPattern {
  /** Regex source (ripgrep + JS compatible subset) with the symbol already escaped in. */
  source: string;
  kind: SymbolKind;
}

type LangGroup = 'tsjs' | 'python' | 'ruby' | 'go' | 'rust' | 'cfamily';

const EXT_TO_GROUP: Record<string, LangGroup> = {
  ts: 'tsjs', tsx: 'tsjs', js: 'tsjs', jsx: 'tsjs', mjs: 'tsjs', cjs: 'tsjs',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  c: 'cfamily', h: 'cfamily', cpp: 'cfamily', cc: 'cfamily', cxx: 'cfamily', hpp: 'cfamily',
  cs: 'cfamily', java: 'cfamily', swift: 'cfamily', kt: 'cfamily', kts: 'cfamily', php: 'cfamily',
};

/** Map a file path to a pattern group, or null when we have no heuristics for it. */
export function groupForPath(filePath: string): LangGroup | null {
  const filename = filePath.toLowerCase().split('/').pop() ?? '';
  const ext = filename.includes('.') ? filename.split('.').pop()! : '';
  return EXT_TO_GROUP[ext] ?? null;
}

/** Escape a string for safe literal use inside a regex (the symbol may contain `$`). */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Each builder takes the escaped symbol `n` and returns ordered patterns.
const BUILDERS: Record<LangGroup, (n: string) => DefinitionPattern[]> = {
  tsjs: (n) => [
    { source: `(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\*?\\s+${n}\\b`, kind: 'function' },
    { source: `(?:export\\s+)?(?:abstract\\s+)?class\\s+${n}\\b`, kind: 'class' },
    { source: `(?:export\\s+)?(?:interface|type|enum)\\s+${n}\\b`, kind: 'type' },
    { source: `(?:export\\s+)?(?:const|let|var)\\s+${n}\\b`, kind: 'variable' },
    { source: `\\b${n}\\s*[:=]\\s*(?:async\\s*)?\\(`, kind: 'method' },
  ],
  python: (n) => [
    { source: `def\\s+${n}\\b`, kind: 'function' },
    { source: `class\\s+${n}\\b`, kind: 'class' },
    { source: `^\\s*${n}\\s*=`, kind: 'variable' },
  ],
  ruby: (n) => [
    { source: `def\\s+(?:self\\.)?${n}\\b`, kind: 'method' },
    { source: `(?:class|module)\\s+${n}\\b`, kind: 'class' },
    { source: `\\b${n}\\s*=`, kind: 'variable' },
  ],
  go: (n) => [
    { source: `func\\s+(?:\\([^)]*\\)\\s*)?${n}\\b`, kind: 'function' },
    { source: `type\\s+${n}\\b`, kind: 'type' },
    { source: `\\b${n}\\s*:?=`, kind: 'variable' },
  ],
  rust: (n) => [
    { source: `fn\\s+${n}\\b`, kind: 'function' },
    { source: `(?:struct|enum|trait|union)\\s+${n}\\b`, kind: 'type' },
    { source: `(?:const|static)\\s+${n}\\b`, kind: 'variable' },
    { source: `let\\s+(?:mut\\s+)?${n}\\b`, kind: 'variable' },
  ],
  cfamily: (n) => [
    { source: `(?:class|interface|enum|struct|trait|protocol)\\s+${n}\\b`, kind: 'type' },
    { source: `(?:func|fun|fn|def|function)\\s+${n}\\b`, kind: 'function' },
    { source: `\\b${n}\\s*\\(`, kind: 'method' },
  ],
};

/**
 * Definition patterns for a file's language, strongest-first. Empty array means
 * we have no heuristics (caller should fall back to a plain reference search).
 */
export function definitionPatterns(filePath: string, symbol: string): DefinitionPattern[] {
  const group = groupForPath(filePath);
  if (!group) return [];
  return BUILDERS[group](escapeRegex(symbol));
}

/** ripgrep/grep pattern matching the symbol as a whole word, for reference search. */
export function referencePattern(symbol: string): string {
  return `\\b${escapeRegex(symbol)}\\b`;
}

/** Valid identifier guard — anything else is rejected before it reaches rg/grep. */
export function isValidSymbol(symbol: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(symbol);
}
