import type { AgentType, SearchHit, SearchResponse, SessionSearchResult } from '@argus/shared';
import { frameToRows, searchRows, type BufferRow } from './scrollbackSearch.js';
import { grepTranscripts, transcriptHit } from './transcriptSearch.js';

/** What a session can be searched in. Sources are read lazily, per search. */
export interface SearchTarget {
  sessionId: string;
  sessionName: string;
  agentType: AgentType;
  /**
   * The scrollback without waking anything: live rows from an awake mirror,
   * the stored frame of a hibernated or exited one, or null.
   */
  scrollback(): { kind: 'live'; rows: BufferRow[] } | { kind: 'frozen'; frame: string } | null;
  /** Validated transcript paths (Claude sessions), possibly empty. */
  transcripts(): string[];
}

export interface CrossSessionSearchOpts {
  limit: number;
  /** null = ripgrep unavailable: transcripts are not searched. */
  rgPath: string | null;
  /** Hits kept per session per source. */
  perSession?: number;
  /** Overall budget; sessions not reached in time are left out. */
  budgetMs?: number;
  now?: () => number;
}

export const SEARCH_PER_SESSION = 20;
export const SEARCH_BUDGET_MS = 4000;

/**
 * Search every target's scrollback and transcripts for `query`, grouped by
 * session. Total hits are capped at `limit`; time at `budgetMs` (scrollback is
 * scanned first, synchronously and cheaply, then one ripgrep run covers every
 * transcript with whatever time is left).
 */
export async function searchSessions(targets: readonly SearchTarget[], query: string, opts: CrossSessionSearchOpts): Promise<SearchResponse> {
  const perSession = opts.perSession ?? SEARCH_PER_SESSION;
  const budget = opts.budgetMs ?? SEARCH_BUDGET_MS;
  const now = opts.now ?? Date.now;
  const started = now();
  let remaining = opts.limit;
  let truncated = false;

  const results: SessionSearchResult[] = [];
  const byPath = new Map<string, SessionSearchResult>();

  for (const t of targets) {
    if (now() - started > budget) {
      truncated = true;
      break;
    }
    const result: SessionSearchResult = { sessionId: t.sessionId, sessionName: t.sessionName, agentType: t.agentType, scrollback: 'none', hits: [] };
    const sb = t.scrollback();
    if (sb && remaining > 0) {
      result.scrollback = sb.kind;
      const rows = sb.kind === 'live' ? sb.rows : frameToRows(sb.frame);
      const cap = Math.min(perSession, remaining);
      let hits = searchRows(rows, query, cap + 1);
      if (hits.length > cap) truncated = true;
      hits = hits.slice(0, cap);
      // Row indices of a stored frame are logical lines, not buffer rows.
      if (sb.kind === 'frozen') hits = hits.map(({ line: _line, ...h }) => h);
      result.hits.push(...hits);
      remaining -= hits.length;
    }
    for (const p of t.transcripts()) byPath.set(p, result);
    results.push(result);
  }

  const timeLeft = budget - (now() - started);
  if (opts.rgPath && byPath.size > 0 && remaining > 0 && timeLeft > 0) {
    const { lines, timedOut } = await grepTranscripts([...byPath.keys()], query, {
      rgPath: opts.rgPath,
      maxPerFile: perSession * 2, // some raw-JSON matches fall outside the message text
      timeoutMs: timeLeft,
    });
    if (timedOut) truncated = true;
    const perResult = new Map<SessionSearchResult, SearchHit[]>();
    // Path order (each session's transcripts oldest first), not rg's output order.
    for (const [p, result] of byPath) {
      const raw = lines.get(p) ?? [];
      const list = perResult.get(result) ?? [];
      for (const line of raw) {
        const hit = transcriptHit(line, query);
        if (hit) list.push(hit);
      }
      perResult.set(result, list);
    }
    for (const [result, list] of perResult) {
      // Newest first, like scrollback: transcripts append.
      list.reverse();
      const cap = Math.min(perSession, remaining);
      if (list.length > cap) truncated = true;
      const kept = list.slice(0, cap);
      result.hits.push(...kept);
      remaining -= kept.length;
      if (remaining <= 0) break;
    }
  }

  return { query, results: results.filter((r) => r.hits.length > 0), truncated };
}
