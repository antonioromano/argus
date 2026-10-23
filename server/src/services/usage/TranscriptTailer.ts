import { JsonlTailer, nodeTranscriptFs, type TranscriptFs } from './JsonlTailer.js';

export { nodeTranscriptFs, type TranscriptFs };

/**
 * Incremental reader of one Claude Code transcript (JSONL), summing the
 * `message.usage` of its assistant entries (F1). The byte-level tailing lives
 * in JsonlTailer.
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

type Contribution = UsageCounters;

export interface TranscriptContext {
  tokens: number;
  model?: string;
}

/**
 * Cross-transcript dedupe hook: asked once per message id; false means the id
 * already counts in another transcript of the same session (a resumed or
 * forked conversation that copied its history), so this one must skip it.
 */
export type ClaimMessage = (id: string, path: string) => boolean;

/** Persisted form: enough to resume tailing without re-reading the file. */
export interface TranscriptTailerState {
  path: string;
  offset: number;
  ino?: number;
  totals: UsageCounters;
  /** Assistant turns counted. */
  turns: number;
  context?: TranscriptContext;
  /** The newest few message contributions, so a message straddling a restart
   *  still dedupes instead of counting twice. */
  recent: [string, Contribution][];
  /** Latest PR Claude Code linked to this conversation (`pr-link` entry). */
  prUrl?: string;
}

/** Message ids remembered for dedupe. Repeats of one message are written back
 *  to back (one entry per content block), so a short window is plenty. */
const SEEN_CAP = 256;
const RECENT_PERSISTED = 8;
const MAX_MODEL_LEN = 100;

/** A github.com pull request URL — the only shape handed on to `gh pr view`. */
const PR_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[0-9]{1,9}$/;

export function isGithubPrUrl(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 300 && PR_URL_RE.test(v);
}

const zero = (): UsageCounters => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

export class TranscriptTailer extends JsonlTailer {
  private seen = new Map<string, Contribution>();
  totals: UsageCounters = zero();
  turns = 0;
  context?: TranscriptContext;
  /**
   * The PR this conversation last created or pushed to. Claude Code writes a
   * `pr-link` entry for those (not for PRs it only reads), so this finds the
   * PR even when the work happened in another repo than the session folder.
   */
  prUrl?: string;

  constructor(path: string, fs: TranscriptFs = nodeTranscriptFs, private claim?: ClaimMessage) {
    super(path, fs);
  }

  static restore(state: TranscriptTailerState, fs: TranscriptFs = nodeTranscriptFs, claim?: ClaimMessage): TranscriptTailer {
    const t = new TranscriptTailer(state.path, fs, claim);
    t.offset = num(state.offset);
    t.ino = state.ino;
    t.totals = { ...zero(), ...state.totals };
    // State written before the cost estimate was removed counted priced and
    // unpriced turns separately.
    const legacy = state as Partial<{ pricedTurns: number; unpricedTurns: number }>;
    t.turns = num(state.turns) || num(legacy.pricedTurns) + num(legacy.unpricedTurns);
    t.context = state.context;
    if (isGithubPrUrl(state.prUrl)) t.prUrl = state.prUrl;
    for (const [id, c] of state.recent ?? []) {
      t.seen.set(id, { input: num(c.input), output: num(c.output), cacheRead: num(c.cacheRead), cacheCreation: num(c.cacheCreation) });
    }
    return t;
  }

  serialize(): TranscriptTailerState {
    return {
      path: this.path,
      offset: this.offset,
      ino: this.ino,
      totals: { ...this.totals },
      turns: this.turns,
      context: this.context,
      recent: [...this.seen.entries()].slice(-RECENT_PERSISTED),
      prUrl: this.prUrl,
    };
  }

  protected clear(): boolean {
    const had = this.turns > 0;
    this.seen.clear();
    this.totals = zero();
    this.turns = 0;
    this.context = undefined;
    this.prUrl = undefined;
    return had;
  }

  /** Apply one JSONL entry. True when it changed the totals or context. */
  protected line(text: string): boolean {
    // A pr-link entry is not a usage change. Other lines that merely contain the
    // string (a Grep for it, say) fall through to the usage parse below.
    if (text.includes('"pr-link"') && this.prLink(text)) return false;
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
    // Bounded: the model string is echoed to every client and persisted.
    const model: string | undefined = typeof msg.model === 'string' ? msg.model.slice(0, MAX_MODEL_LEN) : undefined;
    // Claude Code's locally-generated messages (errors, interrupts) carry zero usage.
    if (model === '<synthetic>') return false;

    const cacheCreation = num(usage.cache_creation_input_tokens);
    const c: Contribution = {
      input: num(usage.input_tokens),
      output: num(usage.output_tokens),
      cacheRead: num(usage.cache_read_input_tokens),
      cacheCreation,
    };

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

    // Subagent (sidechain) turns count toward the totals but don't fill the main context.
    if (!entry.isSidechain) {
      this.context = { tokens: c.input + c.cacheRead + c.cacheCreation, model };
    }
    return true;
  }

  /** Apply a `pr-link` entry. True when the line was one (valid URL or not). */
  private prLink(text: string): boolean {
    let entry: any;
    try {
      entry = JSON.parse(text);
    } catch {
      return false;
    }
    if (entry?.type !== 'pr-link') return false;
    if (isGithubPrUrl(entry.prUrl)) this.prUrl = entry.prUrl;
    return true;
  }

  private apply(c: Contribution, sign: 1 | -1): void {
    this.totals.input += sign * c.input;
    this.totals.output += sign * c.output;
    this.totals.cacheRead += sign * c.cacheRead;
    this.totals.cacheCreation += sign * c.cacheCreation;
    this.turns += sign;
  }
}
