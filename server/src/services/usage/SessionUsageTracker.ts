import path from 'path';
import os from 'os';
import { realpathSync, statSync } from 'fs';
import type { SessionUsage } from '@argus/shared';
import { contextWindowFor } from './contextWindows.js';
import { TranscriptTailer, nodeTranscriptFs, type TranscriptFs, type TranscriptTailerState } from './TranscriptTailer.js';

/**
 * The usage meter of one Argus session (F1): every transcript the session's
 * Claude has written to, summed.
 *
 * `/clear` and `--resume` point Claude at a different transcript file, which
 * the hooks report as a new `transcript_path`. Each file keeps its own tailer
 * (offset, dedupe window, totals), so going back to an earlier file picks up
 * where it left off and nothing is counted twice. Only the current file is
 * read; the others are finished conversations. Context % comes from the
 * current file alone.
 *
 * Polls are debounced (hooks fire in bursts around every tool call) and change
 * notifications are throttled, so a busy session costs at most one small read
 * per debounce window and one broadcast per second.
 */

export interface SessionUsageTrackerState {
  current?: string;
  transcripts: TranscriptTailerState[];
}

export interface SessionUsageTrackerOpts {
  fs?: TranscriptFs;
  debounceMs?: number;
  emitThrottleMs?: number;
  /** Directories a transcript must live under (default: transcriptRoots()). */
  roots?: readonly string[];
}

/** Transcript files remembered per session; the oldest are dropped past this. */
const MAX_TRANSCRIPTS = 32;
const DEFAULT_DEBOUNCE_MS = 400;
const DEFAULT_EMIT_THROTTLE_MS = 1000;
/** Message ids remembered for cross-transcript dedupe (oldest dropped first). */
const MAX_OWNED_IDS = 50_000;

/**
 * Shape check for a hook-reported transcript path before the server opens it:
 * absolute, already normalized (no `..` segments), a plain `*.jsonl` file name.
 * The sender is already authenticated by its per-session token; this keeps a
 * confused or hostile hook from pointing the reader at arbitrary files.
 */
export function isPlausibleTranscriptPath(p: unknown): p is string {
  if (typeof p !== 'string' || p.length === 0 || p.length > 4096 || p.includes('\0')) return false;
  if (!path.isAbsolute(p) || path.normalize(p) !== p) return false;
  return /^[A-Za-z0-9._-]+\.jsonl$/.test(path.basename(p));
}

/** Where Claude keeps transcripts: `$CLAUDE_CONFIG_DIR/projects`, and `~/.claude/projects`. */
export function transcriptRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const roots = [path.join(os.homedir(), '.claude', 'projects')];
  if (env.CLAUDE_CONFIG_DIR) roots.unshift(path.join(env.CLAUDE_CONFIG_DIR, 'projects'));
  return roots;
}

/**
 * The real path of a hook-reported transcript, or undefined unless it is a
 * plausible `*.jsonl` path that resolves (symlinks followed) to a regular file
 * inside one of `roots`. The server only ever opens the returned real path.
 */
export function resolveTranscriptPath(p: unknown, roots: readonly string[] = transcriptRoots()): string | undefined {
  if (!isPlausibleTranscriptPath(p)) return undefined;
  try {
    const real = realpathSync(p);
    if (!statSync(real).isFile()) return undefined;
    const inside = roots.some((r) => {
      try {
        return real.startsWith(realpathSync(r) + path.sep);
      } catch {
        return false;
      }
    });
    return inside ? real : undefined;
  } catch {
    return undefined; // missing (not written yet) — a later hook retries
  }
}

export class SessionUsageTracker {
  private tailers = new Map<string, TranscriptTailer>();
  private current?: string;
  private fs: TranscriptFs;
  private debounceMs: number;
  private emitThrottleMs: number;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private polling = false;
  private pollAgain = false;
  private emitTimer?: ReturnType<typeof setTimeout>;
  private lastEmitAt = 0;
  private disposed = false;
  private roots: readonly string[];
  private updatedAt = 0;
  /** message id → the transcript that counts it. A conversation resumed into a
   *  new file can repeat its history there; only the first file counts it. */
  private owners = new Map<string, string>();
  private readonly claim = (id: string, owner: string): boolean => {
    const cur = this.owners.get(id);
    if (cur !== undefined) return cur === owner;
    this.owners.set(id, owner);
    if (this.owners.size > MAX_OWNED_IDS) this.owners.delete(this.owners.keys().next().value as string);
    return true;
  };

  constructor(private onChange: (usage: SessionUsage) => void, opts: SessionUsageTrackerOpts = {}) {
    this.fs = opts.fs ?? nodeTranscriptFs;
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.emitThrottleMs = opts.emitThrottleMs ?? DEFAULT_EMIT_THROTTLE_MS;
    this.roots = opts.roots ?? transcriptRoots();
  }

  static restore(
    state: SessionUsageTrackerState,
    onChange: (usage: SessionUsage) => void,
    opts: SessionUsageTrackerOpts = {},
  ): SessionUsageTracker {
    const t = new SessionUsageTracker(onChange, opts);
    for (const s of state.transcripts ?? []) {
      if (!isPlausibleTranscriptPath(s.path)) continue;
      t.tailers.set(s.path, TranscriptTailer.restore(s, t.fs, t.claim));
      for (const [id] of s.recent ?? []) t.owners.set(id, s.path);
    }
    // Totals of every transcript are kept, but only a still-valid file is read again.
    if (state.current && t.tailers.has(state.current) && resolveTranscriptPath(state.current, t.roots) === state.current) {
      t.current = state.current;
    }
    t.updatedAt = Date.now();
    return t;
  }

  serialize(): SessionUsageTrackerState {
    return {
      current: this.current,
      transcripts: [...this.tailers.values()].map((t) => t.serialize()),
    };
  }

  /**
   * Every transcript this session has written, re-validated now (still a
   * regular file inside the transcript roots) — the only paths search may read.
   */
  transcriptPaths(): string[] {
    const out: string[] = [];
    for (const p of this.tailers.keys()) {
      if (resolveTranscriptPath(p, this.roots) === p) out.push(p);
    }
    return out;
  }

  /** transcriptPaths() with the transcript Claude is writing now moved last,
   *  so the newest conversation is read first from the end (handoff, F12). */
  transcriptPathsCurrentLast(): string[] {
    const all = this.transcriptPaths();
    const i = this.current ? all.indexOf(this.current) : -1;
    if (i >= 0) all.push(...all.splice(i, 1));
    return all;
  }

  /** The transcript Claude is writing now. A new path starts a new tailer. */
  setTranscript(reported: string): void {
    if (this.disposed) return;
    // Known paths were resolved when first seen; a new one must check out.
    const p = this.tailers.has(reported) ? reported : resolveTranscriptPath(reported, this.roots);
    if (!p) return;
    if (!this.tailers.has(p)) {
      this.tailers.set(p, new TranscriptTailer(p, this.fs, this.claim));
      while (this.tailers.size > MAX_TRANSCRIPTS) {
        const oldest = this.tailers.keys().next().value as string;
        if (oldest === p) break;
        this.tailers.delete(oldest);
      }
    }
    this.current = p;
    this.schedule();
  }

  /** A fresh (non-resume) restart: the next run's context starts empty. */
  clearCurrent(): void {
    if (this.current === undefined) return;
    this.current = undefined;
    this.updatedAt = Date.now();
    this.emitSoon();
  }

  /** Debounced read of the current transcript. `delayMs` overrides the debounce. */
  schedule(delayMs = this.debounceMs): void {
    if (this.disposed || !this.current) return;
    if (this.polling) {
      this.pollAgain = true;
      return;
    }
    if (this.pollTimer) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined;
      void this.pollNow();
    }, delayMs);
  }

  /** Read the current transcript right away (tests, final read on exit). */
  async pollNow(): Promise<void> {
    const tailer = this.current ? this.tailers.get(this.current) : undefined;
    if (!tailer || this.disposed) return;
    this.polling = true;
    try {
      if (await tailer.poll()) {
        this.updatedAt = Date.now();
        this.emitSoon();
      }
    } catch (err) {
      console.warn('[usage] transcript read failed:', err instanceof Error ? err.message : err);
    } finally {
      this.polling = false;
    }
    if (this.pollAgain) {
      this.pollAgain = false;
      this.schedule();
    }
  }

  /** Throttled change notification: leading edge, then at most one per window. */
  private emitSoon(): void {
    if (this.disposed || this.emitTimer) return;
    const wait = Math.max(0, this.lastEmitAt + this.emitThrottleMs - Date.now());
    if (wait === 0) {
      this.flushEmit();
      return;
    }
    this.emitTimer = setTimeout(() => {
      this.emitTimer = undefined;
      this.flushEmit();
    }, wait);
  }

  private flushEmit(): void {
    const usage = this.snapshot();
    if (!usage || this.disposed) return;
    this.lastEmitAt = Date.now();
    this.onChange(usage);
  }

  /** Current meter, or undefined before any transcript turn was seen. */
  snapshot(): SessionUsage | undefined {
    let input = 0;
    let output = 0;
    let cacheRead = 0;
    let cacheCreation = 0;
    let turns = 0;
    for (const t of this.tailers.values()) {
      input += t.totals.input;
      output += t.totals.output;
      cacheRead += t.totals.cacheRead;
      cacheCreation += t.totals.cacheCreation;
      turns += t.turns;
    }
    if (turns === 0) return undefined;

    const usage: SessionUsage = {
      inputTokens: input,
      outputTokens: output,
      cacheCreationTokens: cacheCreation,
      cacheReadTokens: cacheRead,
      totalTokens: input + output + cacheRead + cacheCreation,
      updatedAt: this.updatedAt || Date.now(),
    };
    const ctx = this.current ? this.tailers.get(this.current)?.context : undefined;
    if (ctx) {
      usage.model = ctx.model;
      usage.contextTokens = ctx.tokens;
      const win = contextWindowFor(ctx.model, ctx.tokens);
      if (win) {
        usage.contextWindow = win;
        usage.contextPct = Math.min(100, Math.round((ctx.tokens / win) * 1000) / 10);
      }
    }
    return usage;
  }

  dispose(): void {
    this.disposed = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.pollTimer = undefined;
    this.emitTimer = undefined;
  }
}
