import { execFile } from 'child_process';
import type { SearchHit } from '@argus/shared';
import { makeSnippet } from './scrollbackSearch.js';

/** The readable text of one transcript entry, or null for non-message lines. */
export interface TranscriptMessage {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * Pull the conversation text out of one Claude Code transcript JSONL line:
 * `{"type":"user"|"assistant","message":{"content": string | [{type:"text",text}]}}`.
 * Only `text` blocks count — tool calls, tool results and thinking are skipped,
 * so a hit is something a person actually wrote or read. Malformed lines → null.
 */
export function extractTranscriptMessage(line: string): TranscriptMessage | null {
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  if (!entry || typeof entry !== 'object') return null;
  const { type, message } = entry as { type?: unknown; message?: unknown };
  if ((type !== 'user' && type !== 'assistant') || !message || typeof message !== 'object') return null;
  const content = (message as { content?: unknown }).content;
  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .filter((b): b is { type: 'text'; text: string } => !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string')
      .map((b) => b.text)
      .join('\n');
  }
  return text ? { role: type, text } : null;
}

/** Hit for `query` in a transcript line, or null if its message text does not contain it. */
export function transcriptHit(line: string, query: string): SearchHit | null {
  const msg = extractTranscriptMessage(line);
  if (!msg) return null;
  const at = msg.text.toLowerCase().indexOf(query.toLowerCase());
  if (at === -1) return null; // the raw JSON matched outside the message text
  return { source: 'transcript', role: msg.role, ...makeSnippet(msg.text, at, query.length) };
}

export interface TranscriptSearchOpts {
  rgPath: string;
  /** Matching lines read per file (rg --max-count). */
  maxPerFile: number;
  timeoutMs: number;
}

const MAX_BUFFER = 32 * 1024 * 1024;

/**
 * Search transcript files with ripgrep (fixed-string, case-insensitive), then
 * keep the lines whose message text really contains the query. Paths must
 * already be validated (SessionUsageTracker.transcriptPaths). Resolves to the
 * matching lines per path, newest last, and never rejects.
 */
export function grepTranscripts(paths: readonly string[], query: string, opts: TranscriptSearchOpts): Promise<{ lines: Map<string, string[]>; timedOut: boolean }> {
  const lines = new Map<string, string[]>();
  if (paths.length === 0) return Promise.resolve({ lines, timedOut: false });
  const args = [
    '--fixed-strings', '--ignore-case', '--no-heading', '--with-filename', '--null',
    '--no-line-number', '--color', 'never', '--no-config',
    '--max-count', String(opts.maxPerFile),
    '-e', query, '--', ...paths,
  ];
  return new Promise((resolve) => {
    execFile(opts.rgPath, args, { timeout: opts.timeoutMs, maxBuffer: MAX_BUFFER }, (err, stdout) => {
      const timedOut = !!err && (err as { killed?: boolean }).killed === true;
      for (const raw of (stdout ?? '').split('\n')) {
        const nul = raw.indexOf('\0');
        if (nul === -1) continue;
        const file = raw.slice(0, nul);
        const list = lines.get(file) ?? [];
        list.push(raw.slice(nul + 1));
        lines.set(file, list);
      }
      resolve({ lines, timedOut });
    });
  });
}
