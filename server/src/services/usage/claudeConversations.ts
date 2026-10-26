import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ClaudeConversation } from '@argus/shared';
import { cleanUserText } from './ChatTail.js';
import { resolveWithinBase } from '../../utils/pathScope.js';
import { resolveTranscriptPath, transcriptRoots } from './SessionUsageTracker.js';

/**
 * The Claude conversations of a folder, for the Chat view's /resume picker:
 * Claude Code keeps one `<uuid>.jsonl` per conversation under
 * `~/.claude/projects/<folder, non-alphanumerics as "-">/`. Read-only, and
 * only files that resolve inside the transcript roots are opened.
 */

/** Conversations listed at most, newest first. */
export const MAX_CONVERSATIONS = 50;
const MAX_TITLE = 120;
/** Bytes read from the end (titles, last prompt) and the start (first prompt). */
const TAIL_BYTES = 64 * 1024;
const HEAD_BYTES = 128 * 1024;
const UUID_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;

/** Claude Code's project directory name for `folder`. */
export function projectDirName(folder: string): string {
  return folder.replace(/[^A-Za-z0-9]/g, '-');
}

/** Title of a conversation whose opening prompt did not fit the bytes read. */
export const UNTITLED = 'Untitled conversation';

/**
 * Where a session's conversations live: the current transcript's directory
 * (exact even when Claude Code shortens a long folder name), then the one it
 * derives from the session's work root, under each transcript root.
 */
export function conversationDirs(currentTranscript: string | undefined, workRoot: string, roots: readonly string[]): string[] {
  const dirs = roots.map((r) => path.join(r, projectDirName(workRoot)));
  return currentTranscript ? [path.dirname(currentTranscript), ...dirs] : dirs;
}

function clipTitle(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > MAX_TITLE ? `${one.slice(0, MAX_TITLE - 1)}…` : one;
}

async function readRange(file: string, position: number, length: number): Promise<string> {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, position);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    await fh.close();
  }
}

function parse(line: string): any {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/** The first thing the user typed, as the Chat view shows it. */
function firstPrompt(head: string): string | undefined {
  for (const line of head.split('\n')) {
    if (!line.includes('"user"')) continue;
    const e = parse(line);
    if (e?.type !== 'user' || e.isMeta || e.isSidechain || e.isCompactSummary) continue;
    const c = e.message?.content;
    const raw = typeof c === 'string' ? c : Array.isArray(c) ? c.find((b: any) => b?.type === 'text')?.text : undefined;
    const text = typeof raw === 'string' ? cleanUserText(raw) : '';
    if (text) return text;
  }
  return undefined;
}

/**
 * A conversation's title: its latest custom title (`/rename`, the agent name),
 * else its last prompt, else its first one. Undefined for a file with no user
 * turn at all, which Claude Code's own picker does not offer either.
 */
export async function conversationTitle(file: string, size: number): Promise<string | undefined> {
  const tail = await readRange(file, Math.max(0, size - TAIL_BYTES), Math.min(size, TAIL_BYTES));
  const lines = tail.split('\n');
  let lastPrompt: string | undefined;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"custom-title"') && !line.includes('"last-prompt"')) continue;
    const e = parse(line);
    if (e?.type === 'custom-title' && typeof e.customTitle === 'string' && e.customTitle.trim()) return clipTitle(e.customTitle);
    if (!lastPrompt && e?.type === 'last-prompt' && typeof e.lastPrompt === 'string' && e.lastPrompt.trim()) lastPrompt = e.lastPrompt;
  }
  if (lastPrompt) return clipTitle(lastPrompt);
  const first = firstPrompt(await readRange(file, 0, Math.min(size, HEAD_BYTES)));
  if (first) return clipTitle(first);
  // The opening prompt may just be longer than the head read (a big paste).
  return size > HEAD_BYTES ? UNTITLED : undefined;
}

/**
 * Conversations in `dirs` (deduped), newest first. `currentId` marks the one
 * the session is in now.
 */
export async function listClaudeConversations(
  dirs: readonly string[],
  opts: { currentId?: string; roots?: readonly string[]; limit?: number } = {},
): Promise<ClaudeConversation[]> {
  const roots = opts.roots ?? transcriptRoots();
  // Candidate dirs go through pathScope: each must sit inside a transcript root.
  const scoped = [...new Set(dirs)].filter((d) => roots.some((r) => resolveWithinBase(r, d)));
  const named = new Map<string, string>();
  for (const dir of scoped) {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const m = UUID_FILE.exec(name);
      if (m && !named.has(m[1])) named.set(m[1], path.join(dir, name));
    }
  }
  // Stat in parallel (async, off the event loop); only the files actually
  // opened below are confined, so a folder of thousands costs one stat each.
  const stats = await Promise.all(
    [...named].map(async ([id, file]) => {
      try {
        const s = await stat(file);
        return { id, file, mtime: s.mtimeMs, size: s.size };
      } catch {
        return undefined; // gone meanwhile
      }
    }),
  );
  const newest = stats.filter((f): f is NonNullable<typeof f> => !!f).sort((a, b) => b.mtime - a.mtime);
  const out: ClaudeConversation[] = [];
  for (const f of newest) {
    if (out.length >= (opts.limit ?? MAX_CONVERSATIONS)) break;
    // Every file opened is confined to the transcript roots (symlinks resolved).
    const real = resolveTranscriptPath(f.file, roots);
    if (!real) continue;
    let title: string | undefined;
    try {
      title = await conversationTitle(real, f.size);
    } catch {
      continue;
    }
    if (!title) continue;
    const c: ClaudeConversation = { id: f.id, title, updatedAt: Math.round(f.mtime) };
    if (f.id === opts.currentId) c.current = true;
    out.push(c);
  }
  return out;
}
