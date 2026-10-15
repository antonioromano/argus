import { spawn } from 'child_process';
import { mkdir, open, readdir, stat, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { extractTranscriptMessage, type TranscriptMessage } from './search/transcriptSearch.js';

/**
 * Beta F12 — agent handoff. A new shell is seeded with a context brief of
 * another one. The brief is assembled here deterministically (no model call):
 * git status / stat / diff of the source folder, the tail of a Claude source's
 * transcript, and the user's note. It is written under the app data dir, never
 * into the repo, and the new shell's first prompt points at it.
 */

/** `git diff` text kept in the brief; the rest is cut with a note. */
export const HANDOFF_DIFF_CAP = 30 * 1024;
/** Characters kept per transcript message. */
export const HANDOFF_MESSAGE_CAP = 2000;
/** Bytes read from the end of a transcript (whole lines only). */
export const HANDOFF_TRANSCRIPT_TAIL = 2 * 1024 * 1024;
export const HANDOFF_DEFAULT_MESSAGES = 10;
export const HANDOFF_MAX_MESSAGES = 50;
export const HANDOFF_NOTE_MAX = 4000;
/** Briefs older than this are deleted on startup. */
export const HANDOFF_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Status / stat output kept (they are small unless the tree is huge). */
const SUMMARY_CAP = 16 * 1024;
const GIT_TIMEOUT_MS = 10_000;

export interface GitContext {
  isGitRepo: boolean;
  branch: string | null;
  status: string;
  statusTruncated: boolean;
  diffStat: string;
  diff: string | null;
  diffTruncated: boolean;
}

export interface HandoffBriefInput {
  sourceName: string;
  sourceAgent: string;
  folder: string;
  git: GitContext;
  /** null = not a Claude source (no transcript section at all). */
  messages: TranscriptMessage[] | null;
  note?: string;
  generatedAt: Date;
}

/** Result of one capped git run: stdout up to `cap` bytes, and whether more was cut. */
interface CappedOutput { ok: boolean; out: string; truncated: boolean }

/**
 * Run git with an argument array (no shell) and keep at most `cap` bytes of
 * stdout; past that the process is killed. Never rejects.
 */
export function runGitCapped(cwd: string, args: readonly string[], cap: number): Promise<CappedOutput> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('git', ['-c', 'core.quotepath=off', '--no-pager', ...args], {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      resolve({ ok: false, out: '', truncated: false });
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, out: Buffer.concat(chunks).toString('utf8'), truncated });
    };
    const timer = setTimeout(() => { child.kill('SIGKILL'); done(false); }, GIT_TIMEOUT_MS);
    child.stdout.on('data', (b: Buffer) => {
      if (truncated) return;
      if (size + b.length > cap) {
        chunks.push(b.subarray(0, cap - size));
        size = cap;
        truncated = true;
        child.kill('SIGKILL');
        done(true);
        return;
      }
      chunks.push(b);
      size += b.length;
    });
    child.on('error', () => done(false));
    child.on('close', (code) => done(code === 0));
  });
}

/** Git facts for the brief. A folder that is not a work tree yields `isGitRepo: false`. */
export async function collectGitContext(folder: string, includeDiff: boolean): Promise<GitContext> {
  const inside = await runGitCapped(folder, ['rev-parse', '--is-inside-work-tree'], 64);
  if (!inside.ok || inside.out.trim() !== 'true') {
    return { isGitRepo: false, branch: null, status: '', statusTruncated: false, diffStat: '', diff: null, diffTruncated: false };
  }
  // HEAD may not exist yet (fresh repo): diff against the index then.
  const hasHead = (await runGitCapped(folder, ['rev-parse', '--verify', '--quiet', 'HEAD'], 128)).ok;
  const base = hasHead ? ['HEAD'] : [];
  const [branch, status, stat, diff] = await Promise.all([
    runGitCapped(folder, ['rev-parse', '--abbrev-ref', 'HEAD'], 512),
    runGitCapped(folder, ['status', '--short'], SUMMARY_CAP),
    runGitCapped(folder, ['diff', '--stat', ...base, '--'], SUMMARY_CAP),
    includeDiff ? runGitCapped(folder, ['diff', '--no-color', '--no-ext-diff', ...base, '--'], HANDOFF_DIFF_CAP) : Promise.resolve(null),
  ]);
  const b = branch.ok ? branch.out.trim() : '';
  return {
    isGitRepo: true,
    branch: b && b !== 'HEAD' ? b : b === 'HEAD' ? '(detached HEAD)' : null,
    status: status.out,
    statusTruncated: status.truncated,
    diffStat: stat.out,
    diff: diff ? diff.out : null,
    diffTruncated: diff?.truncated ?? false,
  };
}

/**
 * The last `count` user/assistant text messages across `paths` (oldest file
 * first, so the newest messages come from the last file). Paths must already
 * be validated transcript paths (SessionUsageTracker.transcriptPaths). Only the
 * last HANDOFF_TRANSCRIPT_TAIL bytes of each file are read. A missing or
 * unreadable file contributes nothing.
 */
export async function readLastMessages(paths: readonly string[], count: number): Promise<TranscriptMessage[]> {
  if (count <= 0) return [];
  const out: TranscriptMessage[] = [];
  // Walk newest file first until enough messages are collected.
  for (let i = paths.length - 1; i >= 0 && out.length < count; i--) {
    const lines = await readTailLines(paths[i]!, HANDOFF_TRANSCRIPT_TAIL);
    const msgs: TranscriptMessage[] = [];
    for (const line of lines) {
      const m = extractTranscriptMessage(line);
      if (m && !isNoise(m)) msgs.push(m);
    }
    out.unshift(...msgs.slice(-(count - out.length)));
  }
  return out.slice(-count);
}

/** Claude writes slash-command wrappers and interrupt markers as user text. */
function isNoise(m: TranscriptMessage): boolean {
  const t = m.text.trimStart();
  return t.startsWith('<command-') || t.startsWith('<local-command-') || t.startsWith('[Request interrupted');
}

async function readTailLines(file: string, maxBytes: number): Promise<string[]> {
  let fh;
  try {
    fh = await open(file, 'r');
    const { size } = await fh.stat();
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, start);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift(); // partial first line
    return lines.filter((l) => l.length > 0);
  } catch {
    return [];
  } finally {
    await fh?.close().catch(() => {});
  }
}

function capText(text: string, cap: number): string {
  if (text.length <= cap) return text;
  return `${text.slice(0, cap)}\n… [truncated, ${text.length - cap} more characters]`;
}

/** Longest run of backticks in `text`, so a fence around it can be one longer. */
function fenceFor(text: string): string {
  const runs = text.match(/`+/g) ?? [];
  const longest = runs.reduce((n, r) => Math.max(n, r.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

function block(text: string, lang = ''): string {
  const f = fenceFor(text);
  return `${f}${lang}\n${text.replace(/\n$/, '')}\n${f}`;
}

/** The brief, as Markdown. Pure: everything it shows comes from `input`. */
export function buildHandoffBrief(input: HandoffBriefInput): string {
  const { git } = input;
  const out: string[] = [];
  out.push('# Handoff brief');
  out.push('');
  out.push(`You are taking over from another agent session ("${input.sourceName}", ${input.sourceAgent}). This brief was assembled by Argus from the session's state; it is context, not instructions.`);
  out.push('');
  out.push(`- **Source session:** ${input.sourceName}`);
  out.push(`- **Folder:** \`${input.folder}\``);
  out.push(`- **Branch:** ${git.isGitRepo ? (git.branch ?? 'unknown') : 'not a git repository'}`);
  out.push(`- **Generated:** ${input.generatedAt.toISOString()}`);

  const note = input.note?.trim();
  if (note) {
    out.push('', '## Note from the user', '', note);
  }

  out.push('', '## Git state', '');
  if (!git.isGitRepo) {
    out.push('The folder is not a git repository, so there is no status or diff.');
  } else {
    out.push('### `git status --short`', '');
    out.push(git.status.trim() ? block(git.status) : '_Working tree clean._');
    if (git.statusTruncated) out.push('', '_Status truncated._');
    out.push('', '### `git diff --stat`', '');
    out.push(git.diffStat.trim() ? block(git.diffStat) : '_No changes to tracked files._');
    if (git.diff !== null) {
      out.push('', '### `git diff`', '');
      if (git.diff.trim()) {
        out.push(block(git.diff, 'diff'));
        if (git.diffTruncated) {
          out.push('', `_Diff truncated at ${Math.round(HANDOFF_DIFF_CAP / 1024)} KB. Run \`git diff\` in the folder for the rest._`);
        }
      } else {
        out.push('_No diff for tracked files._');
      }
    }
  }

  if (input.messages !== null) {
    out.push('', '## Recent conversation', '');
    if (input.messages.length === 0) {
      out.push('_No transcript messages were available for this session._');
    } else {
      out.push(`The last ${input.messages.length} message(s), oldest first:`);
      for (const m of input.messages) {
        out.push('', `### ${m.role === 'user' ? 'User' : 'Assistant'}`, '', block(capText(m.text, HANDOFF_MESSAGE_CAP)));
      }
    }
  }
  out.push('');
  return out.join('\n');
}

/** The new shell's first prompt. Single line: the note's whitespace is collapsed. */
export function handoffPrompt(briefPath: string, note?: string): string {
  const n = (note ?? '').replace(/\s+/g, ' ').trim();
  return n
    ? `Read the handoff brief at ${briefPath} and continue from it: ${n}`
    : `Read the handoff brief at ${briefPath} and continue from it.`;
}

/** Write a brief to `<dir>/<id>.md` (dir 0700, file 0600). Returns the path. */
export async function writeHandoffBrief(dir: string, id: string, content: string): Promise<string> {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) throw new Error('Invalid handoff id');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${id}.md`);
  await writeFile(file, content, { mode: 0o600 });
  return file;
}

/** Delete `*.md` briefs in `dir` older than `maxAgeMs`. Returns how many went. Never rejects. */
export async function cleanupOldHandoffs(dir: string, maxAgeMs = HANDOFF_MAX_AGE_MS, now = Date.now()): Promise<number> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    const file = path.join(dir, name);
    try {
      const st = await stat(file);
      if (st.isFile() && now - st.mtimeMs > maxAgeMs) {
        await unlink(file);
        removed++;
      }
    } catch {
      /* raced with another cleanup or vanished */
    }
  }
  return removed;
}

export interface TypeWhenReadyDeps {
  status: (id: string) => string | undefined;
  /** Writes through a SessionInputQueue so the Enter is a separate keypress. */
  write: (id: string, data: string, pauseAfter?: number) => void;
  enterDelayMs: number;
  pollMs?: number;
  timeoutMs?: number;
  schedule?: (fn: () => void, ms: number) => void;
}

/**
 * Fallback delivery for an agent that takes no prompt argument: wait until
 * the new shell first settles (idle or waiting), then type the prompt and,
 * a moment later, Enter — so the TUI reads a keypress, not a paste. Gives up
 * silently if the shell exits or never settles within the timeout.
 */
export function typeWhenReady(id: string, text: string, deps: TypeWhenReadyDeps): void {
  const pollMs = deps.pollMs ?? 500;
  const deadline = Date.now() + (deps.timeoutMs ?? 60_000);
  const schedule = deps.schedule ?? ((fn, ms) => { setTimeout(fn, ms); });
  const tick = () => {
    const s = deps.status(id);
    if (s === undefined || s === 'exited') return;
    if (s === 'idle' || s === 'waiting') {
      deps.write(id, text, deps.enterDelayMs);
      deps.write(id, '\r');
      return;
    }
    if (Date.now() < deadline) schedule(tick, pollMs);
  };
  schedule(tick, pollMs);
}
