import { open, stat } from 'fs/promises';
import { turnCost } from './pricing.js';

/**
 * Incremental reader of one Claude Code transcript (JSONL), summing the
 * `message.usage` of its assistant entries (F1).
 *
 * Reads only the bytes appended since the last poll: it keeps the byte offset
 * of the last complete line and carries an unterminated tail over to the next
 * poll, so a line flushed in two writes is parsed once, whole. A file that
 * shrank or changed inode was rewritten, so its totals are rebuilt from byte 0.
 *
 * Claude Code writes one JSONL entry per content block of a streamed message,
 * each repeating the message's `usage`. Entries are keyed by `message.id`: a
 * repeat replaces the earlier contribution instead of adding to it, and the
 * last one written (which carries the final output count) wins.
 */

export interface UsageCounters {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

interface Contribution extends UsageCounters {
  /** USD, or undefined when the turn's model is unpriced. */
  cost?: number;
}

export interface TranscriptContext {
  tokens: number;
  model?: string;
}

/** Minimal fs surface, injectable for tests. */
export interface TranscriptFs {
  stat(path: string): Promise<{ size: number; ino: number }>;
  read(path: string, position: number, length: number): Promise<Buffer>;
}

/**
 * Cross-transcript dedupe hook: asked once per message id; false means the id
 * already counts in another transcript of the same session (a resumed or
 * forked conversation that copied its history), so this one must skip it.
 */
export type ClaimMessage = (id: string, path: string) => boolean;

export const nodeTranscriptFs: TranscriptFs = {
  async stat(path) {
    const s = await stat(path);
    return { size: s.size, ino: s.ino };
  },
  async read(path, position, length) {
    const fh = await open(path, 'r');
    try {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fh.read(buf, 0, length, position);
      return bytesRead === length ? buf : buf.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
  },
};

/** Persisted form: enough to resume tailing without re-reading the file. */
export interface TranscriptTailerState {
  path: string;
  offset: number;
  ino?: number;
  totals: UsageCounters;
  cost: number;
  pricedTurns: number;
  unpricedTurns: number;
  context?: TranscriptContext;
  /** The newest few message contributions, so a message straddling a restart
   *  still dedupes instead of counting twice. */
  recent: [string, Contribution][];
}

const READ_CHUNK = 1024 * 1024;
/** Message ids remembered for dedupe. Repeats of one message are written back
 *  to back (one entry per content block), so a short window is plenty. */
const SEEN_CAP = 256;
/** An unterminated line longer than this is dropped rather than buffered forever. */
const MAX_LINE_BYTES = 32 * 1024 * 1024;
const RECENT_PERSISTED = 8;

const zero = (): UsageCounters => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

export class TranscriptTailer {
  readonly path: string;
  private offset = 0;
  private ino?: number;
  private leftover: Buffer = Buffer.alloc(0);
  private dropping = false;
  private seen = new Map<string, Contribution>();
  totals: UsageCounters = zero();
  cost = 0;
  pricedTurns = 0;
  unpricedTurns = 0;
  context?: TranscriptContext;

  constructor(path: string, private fs: TranscriptFs = nodeTranscriptFs, private claim?: ClaimMessage) {
    this.path = path;
  }

  static restore(state: TranscriptTailerState, fs: TranscriptFs = nodeTranscriptFs, claim?: ClaimMessage): TranscriptTailer {
    const t = new TranscriptTailer(state.path, fs, claim);
    t.offset = num(state.offset);
    t.ino = state.ino;
    t.totals = { ...zero(), ...state.totals };
    t.cost = num(state.cost);
    t.pricedTurns = num(state.pricedTurns);
    t.unpricedTurns = num(state.unpricedTurns);
    t.context = state.context;
    for (const [id, c] of state.recent ?? []) t.seen.set(id, c);
    return t;
  }

  serialize(): TranscriptTailerState {
    return {
      path: this.path,
      offset: this.offset,
      ino: this.ino,
      totals: { ...this.totals },
      cost: this.cost,
      pricedTurns: this.pricedTurns,
      unpricedTurns: this.unpricedTurns,
      context: this.context,
      recent: [...this.seen.entries()].slice(-RECENT_PERSISTED),
    };
  }

  /** Read whatever was appended since the last poll. Resolves true when totals changed. */
  async poll(): Promise<boolean> {
    let st: { size: number; ino: number };
    try {
      st = await this.fs.stat(this.path);
    } catch {
      return false; // not written yet, or deleted — keep what we have
    }
    let changed = false;
    const readFrom = this.offset + this.leftover.length;
    if ((this.ino !== undefined && st.ino !== this.ino) || st.size < readFrom) {
      changed = this.reset();
    }
    this.ino = st.ino;

    let pos = this.offset + this.leftover.length;
    while (pos < st.size) {
      const len = Math.min(READ_CHUNK, st.size - pos);
      const chunk = await this.fs.read(this.path, pos, len);
      if (chunk.length === 0) break;
      pos += chunk.length;
      if (this.consume(chunk)) changed = true;
    }
    return changed;
  }

  /** Forget everything (the file was rewritten). True when there was anything to forget. */
  private reset(): boolean {
    const had = this.pricedTurns + this.unpricedTurns > 0;
    this.offset = 0;
    this.leftover = Buffer.alloc(0);
    this.dropping = false;
    this.seen.clear();
    this.totals = zero();
    this.cost = 0;
    this.pricedTurns = 0;
    this.unpricedTurns = 0;
    this.context = undefined;
    return had;
  }

  private consume(chunk: Buffer): boolean {
    let changed = false;
    let buf = this.leftover.length ? Buffer.concat([this.leftover, chunk]) : chunk;
    let start = 0;
    for (;;) {
      const nl = buf.indexOf(0x0a, start);
      if (nl === -1) break;
      if (this.dropping) {
        this.dropping = false; // end of an oversized line: resume with the next one
      } else if (nl > start && this.line(buf.toString('utf8', start, nl))) {
        changed = true;
      }
      start = nl + 1;
    }
    this.offset += start;
    buf = buf.subarray(start);
    if (buf.length > MAX_LINE_BYTES) {
      this.offset += buf.length;
      buf = Buffer.alloc(0);
      this.dropping = true;
    }
    // Copy so the retained tail doesn't pin the whole chunk's memory.
    this.leftover = Buffer.from(buf);
    return changed;
  }

  /** Apply one JSONL entry. True when it changed the totals or context. */
  private line(text: string): boolean {
    // Cheap prefilter: most lines (user turns, tool results, attachments) carry no usage.
    if (!text.includes('"usage"') || !text.includes('"assistant"')) return false;
    let entry: any;
    try {
      entry = JSON.parse(text);
    } catch {
      return false;
    }
    if (!entry || entry.type !== 'assistant') return false;
    const msg = entry.message;
    const usage = msg?.usage;
    if (!usage || typeof usage !== 'object') return false;
    const model: string | undefined = typeof msg.model === 'string' ? msg.model : undefined;
    // Claude Code's locally-generated messages (errors, interrupts) carry zero usage.
    if (model === '<synthetic>') return false;

    const cacheCreation = num(usage.cache_creation_input_tokens);
    const cacheWrite1h = Math.min(cacheCreation, num(usage.cache_creation?.ephemeral_1h_input_tokens));
    const c: Contribution = {
      input: num(usage.input_tokens),
      output: num(usage.output_tokens),
      cacheRead: num(usage.cache_read_input_tokens),
      cacheCreation,
    };
    c.cost = turnCost(model, {
      input: c.input,
      output: c.output,
      cacheRead: c.cacheRead,
      cacheWrite5m: cacheCreation - cacheWrite1h,
      cacheWrite1h,
      speed: typeof usage.speed === 'string' ? usage.speed : undefined,
    });

    const id: string | undefined =
      (typeof msg.id === 'string' && msg.id) || (typeof entry.requestId === 'string' && entry.requestId) || undefined;
    if (id && this.claim && !this.claim(id, this.path)) return false; // counted in another transcript
    if (id) {
      const prev = this.seen.get(id);
      if (prev) {
        this.apply(prev, -1);
        this.seen.delete(id); // re-insert below so it counts as most recent
      }
      this.seen.set(id, c);
      if (this.seen.size > SEEN_CAP) this.seen.delete(this.seen.keys().next().value as string);
    }
    this.apply(c, 1);

    // Subagent (sidechain) turns cost money but don't fill the main context.
    if (!entry.isSidechain) {
      this.context = { tokens: c.input + c.cacheRead + c.cacheCreation, model };
    }
    return true;
  }

  private apply(c: Contribution, sign: 1 | -1): void {
    this.totals.input += sign * c.input;
    this.totals.output += sign * c.output;
    this.totals.cacheRead += sign * c.cacheRead;
    this.totals.cacheCreation += sign * c.cacheCreation;
    if (c.cost === undefined) this.unpricedTurns += sign;
    else {
      this.cost += sign * c.cost;
      this.pricedTurns += sign;
    }
  }
}
