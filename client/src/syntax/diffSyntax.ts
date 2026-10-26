import { useMemo } from 'react';
import type { File as DiffFile, Change } from 'parse-diff';
import { langForPath, tokenizeSync, type SynSlot, type SynToken } from './highlighter.js';
import { useGrammarReady } from './useSyntax.js';

/** Tokens for each change line of a parsed diff, keyed by the Change object. */
export type DiffSyntax = Map<Change, SynToken[]>;

// Added/removed rows sit on the --diff-add/--diff-del tints, where the muted
// comment and punctuation colors fall under 4.5:1; those runs keep the row's
// own (audited) --diff-*-fg instead. contrast.test.ts pins this split.
export const CHANGED_ROW_SLOTS: ReadonlySet<SynSlot> = new Set<SynSlot>(['kw', 'str', 'num', 'fn']);

function forChangedRow(line: SynToken[]): SynToken[] {
  return line.map((t) => (t.slot && !CHANGED_ROW_SLOTS.has(t.slot) ? { text: t.text } : t));
}

function lineText(c: Change): string {
  return c.content.replace(/^[+\- ]/, '');
}

/**
 * Tokenize a diff's old side (context + deletions) and new side (context +
 * additions) as two continuous documents, so multi-line constructs (block
 * comments, template strings) keep their state across rows. Context rows take
 * the new side's tokens. Null if the grammar isn't loaded or input too large.
 */
export function diffSyntax(target: DiffFile, lang: string): DiffSyntax | null {
  const oldSide: Change[] = [];
  const newSide: Change[] = [];
  for (const chunk of target.chunks) {
    for (const c of chunk.changes) {
      if (c.type !== 'add') oldSide.push(c);
      if (c.type !== 'del') newSide.push(c);
    }
  }
  const oldTokens = oldSide.some((c) => c.type === 'del')
    ? tokenizeSync(oldSide.map(lineText).join('\n'), lang)
    : [];
  const newTokens = tokenizeSync(newSide.map(lineText).join('\n'), lang);
  if (!oldTokens || !newTokens) return null;
  const out: DiffSyntax = new Map();
  newSide.forEach((c, i) => {
    const line = newTokens[i] ?? [];
    out.set(c, c.type === 'add' ? forChangedRow(line) : line);
  });
  oldSide.forEach((c, i) => {
    if (c.type === 'del') out.set(c, forChangedRow(oldTokens[i] ?? []));
  });
  return out;
}

/** The diff's path as parse-diff reports it (new path, or old for deletions). */
export function diffPath(target: DiffFile): string | undefined {
  return target.to && target.to !== '/dev/null' ? target.to : target.from;
}

/** `diffSyntax` as a hook: plain (null) until the grammar arrives. */
export function useDiffSyntax(target: DiffFile | null, path: string | undefined): DiffSyntax | null {
  const lang = target && path ? langForPath(path) : null;
  const ready = useGrammarReady(lang);
  return useMemo(() => (ready && target && lang ? diffSyntax(target, lang) : null), [ready, target, lang]);
}
