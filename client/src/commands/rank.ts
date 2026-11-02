import { COMMAND_CATEGORIES, type Command, type CommandCategory } from './types.js';

/**
 * Command matching: every query token must appear in order (as a
 * subsequence, so 'tgl thm' finds "Toggle theme") in the title or, at half
 * weight, the keywords and category. Characters at a word start and runs of
 * consecutive characters score higher, so a word-start hit beats a mid-word
 * one. 0 means no match.
 */

const WORD_START = 8;
const RUN = 5;
const CHAR = 1;

function isWordStart(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text[i - 1];
  return !/[a-z0-9]/.test(prev);
}

/** Score one token against `text` (lowercase), trying every start for its first char. */
function tokenScore(token: string, text: string): number {
  let best = 0;
  for (let start = text.indexOf(token[0]); start !== -1; start = text.indexOf(token[0], start + 1)) {
    let score = 0;
    let at = start;
    let prev = -2;
    let ok = true;
    for (const ch of token) {
      const i = text.indexOf(ch, at);
      if (i === -1) { ok = false; break; }
      score += CHAR + (isWordStart(text, i) ? WORD_START : 0) + (i === prev + 1 ? RUN : 0);
      prev = i;
      at = i + 1;
    }
    if (!ok) break; // a later start cannot find what an earlier one missed
    best = Math.max(best, score);
  }
  return best;
}

function fieldScore(tokens: readonly string[], text: string): number {
  let sum = 0;
  for (const t of tokens) {
    const s = tokenScore(t, text);
    if (s === 0) return 0;
    sum += s;
  }
  return sum;
}

export function matchScore(query: string, title: string, extra = ''): number {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  const inTitle = fieldScore(tokens, title.toLowerCase());
  const anywhere = fieldScore(tokens, `${title} ${extra}`.toLowerCase()) / 2;
  return Math.max(inTitle, anywhere);
}

/** A strong text match still beats a frequently used weak one. */
export function boosted(score: number, frecency: number): number {
  return score * (1 + 0.15 * Math.log1p(frecency));
}

export interface RankedGroup {
  category: CommandCategory;
  commands: Command[];
}

/**
 * Matching commands grouped by category. Within a group, best first (ties keep
 * registry order); groups ordered by their best command, then by
 * COMMAND_CATEGORIES.
 */
export function rankCommands(
  commands: readonly Command[],
  query: string,
  frecency: ReadonlyMap<string, number> = new Map(),
): RankedGroup[] {
  const scored = commands
    .map((c, i) => ({
      c,
      i,
      s: boosted(matchScore(query, c.title, `${c.keywords ?? ''} ${c.hint ?? ''} ${c.category}`), frecency.get(c.id) ?? 0),
    }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i);
  const groups = new Map<CommandCategory, { best: number; commands: Command[] }>();
  for (const { c, s } of scored) {
    const g = groups.get(c.category);
    if (g) g.commands.push(c);
    else groups.set(c.category, { best: s, commands: [c] });
  }
  return [...groups.entries()]
    .sort(([ca, a], [cb, b]) => b.best - a.best || COMMAND_CATEGORIES.indexOf(ca) - COMMAND_CATEGORIES.indexOf(cb))
    .map(([category, g]) => ({ category, commands: g.commands }));
}

/** Top `n` commands by frecency (ids never run are skipped). */
export function recentCommands(
  commands: readonly Command[],
  frecency: ReadonlyMap<string, number>,
  n = 5,
): Command[] {
  return commands
    .filter((c) => (frecency.get(c.id) ?? 0) > 0)
    .sort((a, b) => (frecency.get(b.id) ?? 0) - (frecency.get(a.id) ?? 0))
    .slice(0, n);
}

/**
 * The empty query's starter set: an explicit, ordered list, so a new source
 * cannot push these off the first screen. Ids the registry does not hold right
 * now (no Electron menu, beta off) and ids already in Recent are skipped.
 */
export const SUGGESTED_IDS: readonly string[] = [
  'shortcut:new-session',
  'shortcut:waiting-inbox',
  'shortcut:session-search',
  'shortcut:toggle-inspector',
  'view:broadcast',
  'view:launch-template',
  'shortcut:open-settings',
];

export function suggestedCommands(commands: readonly Command[], recent: readonly Command[] = []): Command[] {
  const byId = new Map(commands.map((c) => [c.id, c]));
  const taken = new Set(recent.map((c) => c.id));
  return SUGGESTED_IDS.filter((id) => !taken.has(id)).flatMap((id) => byId.get(id) ?? []);
}

/** Every command under its category, in COMMAND_CATEGORIES order (the `>` scope's browse view). */
export function browseCommands(commands: readonly Command[]): RankedGroup[] {
  return COMMAND_CATEGORIES
    .map((category) => ({ category, commands: commands.filter((c) => c.category === category) }))
    .filter((g) => g.commands.length > 0);
}
