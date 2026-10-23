import path from 'path';
import os from 'os';
import { realpathSync, statSync } from 'fs';
import type { ChatMessage, ChatUpdate, SessionUsage } from '@argus/shared';
import { contextWindowFor } from './contextWindows.js';
import { ChatTail } from './ChatTail.js';
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
  /** Chat view safety-net poll while a chat is open (hooks drive the rest). */
  chatPollMs?: number;
}

/** A chat view update without its session id (the caller adds it). */
export type ChatSink = (update: Omit<ChatUpdate, 'sessionId'>) => void;

/** What a new chat viewer is sent first. */
export interface ChatSnapshot {
  available: boolean;
  messages: ChatMessage[];
  permissionMode?: string;
  modelSet?: string;
}

/** Transcript files remembered per session; the oldest are dropped past this. */
const MAX_TRANSCRIPTS = 32;
const DEFAULT_DEBOUNCE_MS = 400;
const DEFAULT_EMIT_THROTTLE_MS = 1000;
const DEFAULT_CHAT_POLL_MS = 1000;
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
  // Chat view (B1): a separate reader of the current transcript, alive only
  // while someone has the Chat view open. Reads are serialized on chatQueue.
  private chat?: ChatTail;
  private chatSink?: ChatSink;
  private chatQueue: Promise<void> = Promise.resolve();
  private chatTimer?: ReturnType<typeof setInterval>;
  private chatPollMs: number;
  /** The first read after openChat() is answered by chatSnapshot(), not the sink. */
  private chatSwallowReset = false;
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
    this.chatPollMs = opts.chatPollMs ?? DEFAULT_CHAT_POLL_MS;
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

  /** The PR the current conversation last created or pushed to, if any. */
  linkedPrUrl(): string | undefined {
    return this.current ? this.tailers.get(this.current)?.prUrl : undefined;
  }

  /** A fresh (non-resume) restart: the next run's context starts empty. */
  clearCurrent(): void {
    if (this.current === undefined) return;
    this.current = undefined;
    this.updatedAt = Date.now();
    this.emitSoon();
    void this.readChatSoon();
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
    void this.readChatSoon();
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

  /**
   * Start the chat feed. Later changes (new messages, or a reset when Claude
   * moves to another transcript) go to `sink`; the state as of the first read
   * is what chatSnapshot() returns once this resolves.
   */
  async openChat(sink: ChatSink): Promise<void> {
    if (this.disposed) return;
    if (!this.chatSink) {
      this.chatSwallowReset = true;
      this.chatTimer = setInterval(() => void this.readChatSoon(), this.chatPollMs);
      this.chatTimer.unref?.();
    }
    this.chatSink = sink;
    await this.readChatSoon();
  }

  /** Stop the chat feed and drop its messages (nobody is looking). */
  closeChat(): void {
    if (this.chatTimer) clearInterval(this.chatTimer);
    this.chatTimer = undefined;
    this.chatSink = undefined;
    this.chat = undefined;
  }

  chatSnapshot(): ChatSnapshot {
    const available = !!this.chat && this.chat.path === this.current;
    if (!available) return { available, messages: [] };
    const snap: ChatSnapshot = { available, messages: [...this.chat!.messages] };
    if (this.chat!.permissionMode) snap.permissionMode = this.chat!.permissionMode;
    if (this.chat!.modelSet) snap.modelSet = this.chat!.modelSet;
    return snap;
  }

  /** Queue one chat read behind any in flight; resolves when it is done. */
  private readChatSoon(): Promise<void> {
    if (!this.chatSink) return this.chatQueue;
    this.chatQueue = this.chatQueue.then(() => this.readChat());
    return this.chatQueue;
  }

  private async readChat(): Promise<void> {
    const sink = this.chatSink;
    if (!sink || this.disposed) return;
    const swallow = this.chatSwallowReset;
    this.chatSwallowReset = false;
    if (!this.current) {
      if (this.chat) {
        this.chat = undefined;
        if (!swallow) sink({ reset: true, available: false, messages: [] });
      }
      return;
    }
    if (this.chat?.path !== this.current) this.chat = new ChatTail(this.current, this.fs);
    const chat = this.chat;
    try {
      await chat.poll();
    } catch (err) {
      console.warn('[chat] transcript read failed:', err instanceof Error ? err.message : err);
    }
    // Closed, or moved to another transcript, while reading: that read is stale.
    if (this.chatSink !== sink || this.chat !== chat) return;
    const delta = chat.drain();
    const meta = delta.permissionMode !== undefined || delta.modelSet !== undefined;
    if (delta.reset ? !swallow : delta.messages.length > 0 || meta) {
      const update: Parameters<ChatSink>[0] = { reset: delta.reset, available: true, messages: delta.messages };
      if (delta.permissionMode !== undefined) update.permissionMode = delta.permissionMode;
      if (delta.modelSet !== undefined) update.modelSet = delta.modelSet;
      sink(update);
    }
  }

  dispose(): void {
    this.closeChat();
    this.disposed = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.pollTimer = undefined;
    this.emitTimer = undefined;
  }
}
