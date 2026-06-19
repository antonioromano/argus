import { Router } from 'express';
import { execFile } from 'child_process';
import path from 'path';
import type { SessionManager } from '../services/SessionManager.js';
import type { SymbolLocation, DefinitionResponse, ReferencesResponse } from '@argus/shared';
import { getRipgrepPath } from '../utils/ripgrep.js';
import { EXCLUDED_SEARCH_DIRS } from '../utils/searchExclusions.js';
import { definitionPatterns, referencePattern, isValidSymbol, type DefinitionPattern } from '../utils/symbolPatterns.js';

const DEFINITION_CAP = 50;
const REFERENCE_CAP = 200;
const SEARCH_TIMEOUT_MS = 8000;
const MAX_BUFFER = 16 * 1024 * 1024; // reference output can be large before the cap

interface RawHit {
  path: string;
  line: number;
  text: string;
}

/** Parse `path:line:text` output (rg --no-heading -n / grep -rn) into hits. */
function parseHits(stdout: string, root: string): RawHit[] {
  if (!stdout) return [];
  const hits: RawHit[] = [];
  for (const raw of stdout.split('\n')) {
    if (!raw) continue;
    // Skip the "/root/" prefix so a colon inside the path can't be misread.
    const colon = raw.indexOf(':', root.length + 1);
    if (colon === -1) continue;
    const filePath = raw.slice(0, colon);
    const rest = raw.slice(colon + 1);
    const nextColon = rest.indexOf(':');
    if (nextColon === -1) continue;
    const line = parseInt(rest.slice(0, nextColon), 10);
    if (!Number.isFinite(line)) continue;
    hits.push({ path: filePath, line, text: rest.slice(nextColon + 1) });
  }
  return hits;
}

/** Run a search and resolve to { hits, timedOut }, never rejecting. */
function runSearch(cmd: string, args: string[], root: string): Promise<{ hits: RawHit[]; timedOut: boolean }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: SEARCH_TIMEOUT_MS, maxBuffer: MAX_BUFFER }, (err, stdout) => {
      // rg/grep exit 1 == "no matches" (not an error). A killed process == timeout.
      const timedOut = !!err && (err as NodeJS.ErrnoException & { killed?: boolean }).killed === true;
      resolve({ hits: parseHits(stdout ?? '', root), timedOut });
    });
  });
}

function rgArgs(rg: string, patternSources: string[], root: string): string[] {
  const globs = [...EXCLUDED_SEARCH_DIRS].flatMap((d) => ['--glob', `!**/${d}/**`]);
  const patterns = patternSources.flatMap((p) => ['-e', p]);
  return ['--no-heading', '-n', '--color', 'never', ...globs, ...patterns, '--', root];
}

/** grep fallback: portable whole-word literal search (BSD grep lacks \b/\s in -E). */
function grepWordArgs(symbol: string, root: string): string[] {
  const excludeDirs = [...EXCLUDED_SEARCH_DIRS].flatMap((d) => ['--exclude-dir', d]);
  return ['-rnw', '-F', '-e', symbol, ...excludeDirs, '--', root];
}

function columnOf(text: string, symbol: string): number {
  const idx = text.indexOf(symbol);
  return idx === -1 ? 1 : idx + 1;
}

/** Re-test a line against ordered definition patterns; lower rank = stronger. */
function classify(text: string, compiled: { re: RegExp; pat: DefinitionPattern }[]): { rank: number; kind: SymbolLocation['kind'] } {
  for (let i = 0; i < compiled.length; i++) {
    if (compiled[i].re.test(text)) return { rank: i, kind: compiled[i].pat.kind };
  }
  return { rank: compiled.length, kind: 'unknown' };
}

export function createSymbolRoutes(sessionManager: SessionManager): Router {
  const router = Router();

  router.get('/definition', async (req, res) => {
    const rawPath = req.query.path as string;
    const symbol = req.query.symbol as string;
    const fromLine = parseInt(req.query.line as string, 10);

    const empty: DefinitionResponse = { symbol: symbol ?? '', locations: [], truncated: false };
    if (!rawPath || !symbol || !isValidSymbol(symbol)) {
      res.json(empty);
      return;
    }

    const owner = sessionManager.sessionForPath(rawPath);
    if (!owner) {
      res.status(403).json({ error: 'path is outside any session working directory' });
      return;
    }
    const root = owner.session.folderPath;
    const rg = getRipgrepPath();

    const patterns = definitionPatterns(rawPath, symbol);
    let hits: RawHit[];
    let timedOut = false;
    let weak = false;

    if (rg && patterns.length > 0) {
      const out = await runSearch(rg, rgArgs(rg, patterns.map((p) => p.source), root), root);
      hits = out.hits;
      timedOut = out.timedOut;
    } else {
      // No heuristics (unknown language) or no ripgrep → whole-word fallback.
      weak = true;
      const out = rg
        ? await runSearch(rg, rgArgs(rg, [referencePattern(symbol)], root), root)
        : await runSearch('grep', grepWordArgs(symbol, root), root);
      hits = out.hits;
      timedOut = out.timedOut;
    }

    const compiled = patterns.map((pat) => ({ pat, re: new RegExp(pat.source) }));

    const ranked: (SymbolLocation & { _rank: number; _sameFile: boolean })[] = hits
      // Drop the exact invocation site.
      .filter((h) => !(h.path === owner.resolved && h.line === fromLine))
      .map((h) => {
        const { rank, kind } = weak ? { rank: 0, kind: 'unknown' as const } : classify(h.text, compiled);
        return {
          path: h.path,
          line: h.line,
          column: columnOf(h.text, symbol),
          preview: h.text.trim().slice(0, 200),
          kind,
          confidence: weak ? ('weak' as const) : ('strong' as const),
          _rank: rank,
          _sameFile: h.path === owner.resolved,
        };
      });

    ranked.sort((a, b) => {
      if (a._sameFile !== b._sameFile) return a._sameFile ? -1 : 1; // same file first
      if (a._rank !== b._rank) return a._rank - b._rank; // stronger pattern first
      if (a.path !== b.path) return a.path < b.path ? -1 : 1;
      return a.line - b.line;
    });

    const truncated = timedOut || ranked.length > DEFINITION_CAP;
    const result: DefinitionResponse = {
      symbol,
      // Strip the internal sort keys (_rank, _sameFile) from the wire response.
      locations: ranked.slice(0, DEFINITION_CAP).map(({ _rank, _sameFile, ...loc }) => loc),
      truncated,
    };
    res.json(result);
  });

  router.get('/references', async (req, res) => {
    const rawPath = req.query.path as string;
    const symbol = req.query.symbol as string;

    const empty: ReferencesResponse = { symbol: symbol ?? '', locations: [], truncated: false };
    if (!rawPath || !symbol || !isValidSymbol(symbol)) {
      res.json(empty);
      return;
    }

    const owner = sessionManager.sessionForPath(rawPath);
    if (!owner) {
      res.status(403).json({ error: 'path is outside any session working directory' });
      return;
    }
    const root = owner.session.folderPath;
    const rg = getRipgrepPath();

    const out = rg
      ? await runSearch(rg, rgArgs(rg, [referencePattern(symbol)], root), root)
      : await runSearch('grep', grepWordArgs(symbol, root), root);

    const locations: SymbolLocation[] = out.hits.map((h) => ({
      path: h.path,
      line: h.line,
      column: columnOf(h.text, symbol),
      preview: h.text.trim().slice(0, 200),
      kind: 'unknown',
      confidence: 'weak',
    }));

    locations.sort((a, b) => {
      const aSame = a.path === owner.resolved;
      const bSame = b.path === owner.resolved;
      if (aSame !== bSame) return aSame ? -1 : 1;
      if (a.path !== b.path) return a.path < b.path ? -1 : 1;
      return a.line - b.line;
    });

    const truncated = out.timedOut || locations.length > REFERENCE_CAP;
    const result: ReferencesResponse = { symbol, locations: locations.slice(0, REFERENCE_CAP), truncated };
    res.json(result);
  });

  return router;
}
