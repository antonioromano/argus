import { spawn } from 'child_process';
import { createInterface } from 'readline';
import path from 'path';
import type { FindInFilesFile, FindInFilesMatch, FindInFilesResponse } from '@argus/shared';
import { BINARY_EXTENSIONS, EXCLUDED_SEARCH_DIRS, EXCLUDED_SEARCH_EXTS } from '../../utils/searchExclusions.js';

export const FIND_QUERY_MAX = 500;
export const FIND_GLOB_MAX = 32;
export const FIND_GLOB_LENGTH_MAX = 256;

export interface FindInFilesOptions {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  include: string[];
  exclude: string[];
}

export interface FindInFilesLimits {
  /** Matching lines returned in total before the search is stopped. */
  maxMatches: number;
  /** Matching lines read per file (rg --max-count). */
  maxPerFile: number;
  timeoutMs: number;
}

export const DEFAULT_FIND_LIMITS: FindInFilesLimits = {
  maxMatches: 2000,
  maxPerFile: 100,
  timeoutMs: 10_000,
};

/** Characters of a matched line sent to the client. */
const PREVIEW_MAX = 240;
/** Context kept before the first match when a long line is windowed. */
const PREVIEW_LEAD = 40;

export class FindInFilesError extends Error {}

/**
 * Split a comma-separated glob list the way VS Code's include/exclude boxes do:
 * commas inside `{a,b}` braces belong to the glob. Returns null when the list
 * breaks a limit (count, length, control characters), so the route can 400.
 */
export function parseGlobList(raw: unknown): string[] | null {
  if (raw === undefined || raw === '') return [];
  if (typeof raw !== 'string') return null;
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of raw) {
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  const globs = out.map((g) => g.trim()).filter(Boolean);
  if (globs.length > FIND_GLOB_MAX) return null;
  // eslint-disable-next-line no-control-regex
  if (globs.some((g) => g.length > FIND_GLOB_LENGTH_MAX || /[\x00-\x1f]/.test(g))) return null;
  return globs;
}

/**
 * ripgrep argv for a search of the cwd (findInFiles runs rg *in* the root, so
 * globs containing a `/` anchor to it, as in VS Code). Everything user-supplied
 * is bound to its flag (`-e`, `--glob=`) and the path follows `--`, so no value
 * can be read as an option. The mandatory exclusions come last: in ripgrep the later glob
 * wins, so an include like `node_modules/**` cannot re-open a skipped tree.
 */
export function buildRgArgs(opts: FindInFilesOptions, limits: FindInFilesLimits = DEFAULT_FIND_LIMITS): string[] {
  const args = [
    '--json',
    '--no-config',
    '--hidden',
    '--no-messages',
    '--max-count', String(limits.maxPerFile),
    opts.caseSensitive ? '--case-sensitive' : '--ignore-case',
  ];
  if (!opts.regex) args.push('--fixed-strings');
  if (opts.wholeWord) args.push('--word-regexp');
  for (const g of opts.include) args.push(`--glob=${g}`);
  for (const g of opts.exclude) args.push(`--glob=!${g.replace(/^!+/, '')}`);
  for (const d of EXCLUDED_SEARCH_DIRS) args.push(`--glob=!**/${d}/**`);
  // --iglob: the extension rule is case-insensitive (`.PNG` is skipped like `.png`).
  for (const ext of [...EXCLUDED_SEARCH_EXTS, ...BINARY_EXTENSIONS]) args.push(`--iglob=!*${ext}`);
  args.push('-e', opts.query, '--', '.');
  return args;
}

/**
 * Map byte offsets into `buf` (rg reports byte offsets) to UTF-16 offsets in one
 * pass: each byte segment is decoded once, so a huge line with many submatches
 * stays linear.
 */
function charOffsets(buf: Buffer, bytes: number[]): Map<number, number> {
  const out = new Map<number, number>();
  let prevByte = 0;
  let chars = 0;
  for (const b of [...new Set(bytes)].sort((x, y) => x - y)) {
    const end = Math.min(Math.max(b, prevByte), buf.length);
    chars += buf.subarray(prevByte, end).toString('utf8').length;
    prevByte = end;
    out.set(b, chars);
  }
  return out;
}

/**
 * Turn one rg `match` line into the wire shape: byte offsets → UTF-16 offsets,
 * leading whitespace trimmed, and long lines windowed around the first match.
 */
export function toMatch(lineText: string, lineNumber: number, submatches: { start: number; end: number }[]): FindInFilesMatch {
  const buf = Buffer.from(lineText, 'utf8');
  let text = lineText.replace(/\r?\n$/, '');
  const offs = charOffsets(buf, submatches.flatMap((s) => [s.start, s.end]));
  let ranges: [number, number][] = submatches.map((s) => [offs.get(s.start)!, offs.get(s.end)!]);
  const column = (ranges[0]?.[0] ?? 0) + 1;

  const lead = text.length - text.trimStart().length;
  let start = lead;
  if (ranges.length > 0 && ranges[0][0] - start > PREVIEW_MAX - PREVIEW_LEAD) {
    start = Math.max(lead, ranges[0][0] - PREVIEW_LEAD);
  }
  const end = Math.min(text.length, start + PREVIEW_MAX);
  text = text.slice(start, end).trimEnd();
  ranges = ranges
    .map(([a, b]): [number, number] => [Math.max(0, a - start), Math.min(text.length, b - start)])
    .filter(([a, b]) => b > a);
  return { line: lineNumber, column, preview: text, ranges };
}

interface RgMatchEvent {
  type: string;
  data?: {
    path?: { text?: string };
    lines?: { text?: string };
    line_number?: number;
    submatches?: { start: number; end: number }[];
  };
}

/**
 * Run a Find in Files search with ripgrep. Output is streamed and the process is
 * killed as soon as `maxMatches` is reached or the timeout fires; either one marks
 * the response truncated. A bad regex rejects with FindInFilesError (rg's message).
 */
export function findInFiles(
  rgPath: string,
  root: string,
  opts: FindInFilesOptions,
  limits: FindInFilesLimits = DEFAULT_FIND_LIMITS,
): Promise<FindInFilesResponse> {
  return new Promise((resolve, reject) => {
    const child = spawn(rgPath, buildRgArgs(opts, limits), { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    const files: FindInFilesFile[] = [];
    const byPath = new Map<string, FindInFilesFile>();
    let total = 0;
    let truncated = false;
    let stderr = '';
    let settled = false;

    const stop = () => {
      truncated = true;
      child.kill();
    };
    const timer = setTimeout(stop, limits.timeoutMs);

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < 4096) stderr += chunk;
    });

    const rl = createInterface({ input: child.stdout });
    rl.on('line', (raw) => {
      if (truncated) return;
      let ev: RgMatchEvent;
      try {
        ev = JSON.parse(raw) as RgMatchEvent;
      } catch {
        return;
      }
      if (ev.type !== 'match' || !ev.data) return;
      const relPath = ev.data.path?.text;
      const lineText = ev.data.lines?.text;
      // Non-UTF-8 paths/lines come back as base64 `bytes`; nothing useful to show.
      if (!relPath || lineText === undefined || !ev.data.line_number) return;
      const filePath = path.join(root, relPath);
      let file = byPath.get(filePath);
      if (!file) {
        file = { path: filePath, matches: [] };
        byPath.set(filePath, file);
        files.push(file);
      }
      file.matches.push(toMatch(lineText, ev.data.line_number, ev.data.submatches ?? []));
      total++;
      if (total >= limits.maxMatches) stop();
    });

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Exit 1 == no matches; 2 == an error. --no-messages silences per-file errors
      // (an unreadable file also exits 2), so only a message on stderr — a bad
      // regex — makes the search itself fail.
      if (code === 2 && !truncated && total === 0 && stderr.trim()) {
        reject(new FindInFilesError(stderr.trim().replace(/^rg: /, '')));
        return;
      }
      resolve({ query: opts.query, files, totalMatches: total, truncated });
    };
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    // 'close' fires after stdout is drained, so every line has been parsed.
    child.on('close', (code) => {
      rl.close();
      finish(code);
    });
  });
}
