import path from 'path';
import type { AgentRun, AgentRunStatus, ChatToolBlock } from '@argus/shared';
import { JsonlTailer, nodeTranscriptFs, type TranscriptFs } from './JsonlTailer.js';
import type { TaskNotification } from './TranscriptTailer.js';
import { toolBlockOf, toolResultsOf, withResult } from './chatTools.js';

/**
 * The agents of one Claude session, read from Claude Code's own files in the
 * `subagents/` folder next to the transcript: `agent-<id>.meta.json` (written
 * at launch, gains `finished` when the agent ends) and `agent-<id>.jsonl` (the
 * agent's transcript, same entry format as the main one).
 *
 * Running is decided by the meta `finished` flag and the writer's version only
 * (spec D1), never by elapsed time: older Claude Code never sets the flag, so
 * its agents are listed as finished. An agent ends on the first of meta
 * `finished`, a task notification (remembered, so one read before the agent
 * is first listed still counts), `failAll()`, or the run-start rule; the first
 * end wins. Agents already finished at first sight are listed from meta alone
 * and never tailed.
 *
 * Claude Code writes no `finished` for an agent stopped with TaskStop, killed
 * or crashed. The run-start rule covers those whose notification was missed:
 * an unfinished agent whose last jsonl entry (fallback: jsonl mtime) predates
 * the current Claude process belonged to a process that is gone, and a
 * resumed run never continues it, so it is `failed` at first sight.
 */

/** First Claude Code version that writes `finished` into an agent's meta file. */
export const AGENT_FINISHED_FLAG_MIN_VERSION = '2.1.301';
/** A running agent whose jsonl has not grown for this long reports `quietMinutes`. */
export const AGENT_QUIET_MS = 5 * 60_000;
/** Most agents in the broadcast list. */
export const AGENT_ROSTER_CAP = 20;

/** Hex ids, and named ones such as `ap2-palette-fe28114a195e07d2`: no dots, no slashes. */
const ID_PATTERN = '[A-Za-z0-9][A-Za-z0-9-]{5,95}';
const META_RE = new RegExp(`^agent-(${ID_PATTERN})\\.meta\\.json$`);
const AGENT_ID_RE = new RegExp(`^${ID_PATTERN}$`);
/** The head of a jsonl read to learn its writer's version; an older writer's agent is never tailed past it. */
export const AGENT_VERSION_PROBE_BYTES = 64 * 1024;
/** A failing read is logged at most once per agent (or folder) per this long. */
const WARN_EVERY_MS = 60_000;
/** Task notifications remembered for agents not listed yet; the oldest drop off first. */
const NOTIFIED_CAP = 1000;

/** An agent id as Claude Code names its files (the `<id>` of `agent-<id>.jsonl`); safe in a file name. */
export function isAgentId(id: string): boolean {
  return AGENT_ID_RE.test(id);
}
const MAX_DESCRIPTION = 200;
const MAX_FIELD = 128;
/** Message ids remembered for output-token dedup (streamed entries repeat one message). */
const SEEN_CAP = 512;

export interface AgentRosterOpts {
  fs?: TranscriptFs;
  now?: () => number;
  /** When the current Claude process started (ms): see the run-start rule. */
  runStartedAt?: number;
}

interface Meta {
  agentType: string;
  description: string;
  toolUseId?: string;
  background: boolean;
  depth: number;
  parentAgentId?: string;
  finished: boolean;
}

interface Agent {
  id: string;
  meta: Meta;
  /** `mtimeMs:size` of the meta file last read. */
  metaSig: string;
  /** Meta mtime at first sight: `startedAt` until the jsonl names one. */
  firstSeenAt: number;
  /** Only for agents not finished at first sight. */
  tail?: AgentTail;
  /** Set by the first end event; never changes after. */
  ended?: End;
  /** The run-start rule was applied (once, on the first read that knows the version). */
  runChecked?: boolean;
}

type End = { status: Exclude<AgentRunStatus, 'running'>; at?: number };

function parseVersion(v: string): [number, number, number] | undefined {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

/** a < b, comparing `major.minor.patch` as numbers; an unparseable `a` counts as older. */
function versionBelow(a: string | undefined, b: string): boolean {
  const pa = a ? parseVersion(a) : undefined;
  const pb = parseVersion(b)!;
  if (!pa) return true;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i];
  return false;
}

const str = (v: unknown, max = MAX_FIELD): string | undefined =>
  typeof v === 'string' && v ? v.slice(0, max) : undefined;

function parseMeta(text: string): Meta | undefined {
  let m: any;
  try {
    m = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return undefined;
  const depth = typeof m.spawnDepth === 'number' && Number.isInteger(m.spawnDepth) && m.spawnDepth >= 1 ? m.spawnDepth : 1;
  const meta: Meta = {
    agentType: str(m.agentType) ?? 'agent',
    description: str(m.description, MAX_DESCRIPTION) ?? '',
    background: m.requestShape === 'background',
    depth,
    finished: m.finished === true,
  };
  const toolUseId = str(m.toolUseId);
  if (toolUseId) meta.toolUseId = toolUseId;
  const parent = str(m.parentAgentId);
  if (parent) meta.parentAgentId = parent;
  return meta;
}

/** Folds an agent's jsonl into tokens, its latest tool step, its version and its first/last timestamps. */
class AgentTail extends JsonlTailer {
  /** Output tokens per assistant message id; a re-streamed message replaces its earlier count. */
  private outputs = new Map<string, number>();
  outputTokens = 0;
  lastStep?: ChatToolBlock;
  version?: string;
  firstAt?: number;
  lastAt?: number;

  protected clear(): boolean {
    const had = this.firstAt !== undefined;
    this.outputs.clear();
    this.outputTokens = 0;
    this.lastStep = undefined;
    this.version = undefined;
    this.firstAt = undefined;
    this.lastAt = undefined;
    return had;
  }

  protected line(text: string): boolean {
    let e: any;
    try {
      e = JSON.parse(text);
    } catch {
      return false;
    }
    if (!e || typeof e !== 'object') return false;
    let changed = false;
    const at = typeof e.timestamp === 'string' ? Date.parse(e.timestamp) : NaN;
    if (Number.isFinite(at)) {
      if (this.firstAt === undefined) this.firstAt = at;
      if (this.lastAt === undefined || at > this.lastAt) this.lastAt = at;
      changed = true;
    }
    if (typeof e.version === 'string' && parseVersion(e.version) && versionBelow(this.version, e.version)) {
      this.version = e.version.slice(0, 32);
    }
    const content = e.message?.content;
    if (e.type === 'assistant') {
      const out = e.message?.usage?.output_tokens;
      if (typeof out === 'number' && Number.isFinite(out) && out > 0) {
        const id = str(e.message?.id) ?? str(e.requestId) ?? `line:${this.offset}`;
        this.outputTokens += out - (this.outputs.get(id) ?? 0);
        this.outputs.delete(id);
        this.outputs.set(id, out);
        if (this.outputs.size > SEEN_CAP) this.outputs.delete(this.outputs.keys().next().value as string);
      }
      if (Array.isArray(content)) {
        for (const b of content) if (b && typeof b === 'object' && b.type === 'tool_use') this.lastStep = toolBlockOf(b);
      }
    } else if (e.type === 'user' && this.lastStep) {
      for (const r of toolResultsOf(content, e.toolUseResult)) {
        if (r.id === this.lastStep.id) this.lastStep = withResult(this.lastStep, r);
      }
    }
    return changed;
  }
}

export class AgentRoster {
  private readonly fs: TranscriptFs;
  private readonly now: () => number;
  private readonly roster = new Map<string, Agent>();
  /** `mtimeMs:size` of meta files that did not parse, so they are re-read only once changed. */
  private readonly badMetas = new Map<string, string>();
  /** Task notifications by `id:<taskId>` / `tool:<toolUseId>`, for agents first listed after them. */
  private readonly notified = new Map<string, End>();
  /** Last warning per key (agent id or the folder), for the rate limit. */
  private readonly warnedAt = new Map<string, number>();
  private runStartedAt?: number;
  private hash = '[]';
  private inflight?: Promise<boolean>;
  private disposed = false;

  constructor(private readonly folder: string, opts: AgentRosterOpts = {}) {
    this.fs = opts.fs ?? nodeTranscriptFs;
    this.now = opts.now ?? Date.now;
    this.runStartedAt = opts.runStartedAt;
  }

  /** A new Claude process started at `ms`: agents first seen from now on are judged against it. */
  setRunStartedAt(ms: number | undefined): void {
    this.runStartedAt = ms;
  }

  private warn(key: string, what: string, err: unknown): void {
    const now = this.now();
    const last = this.warnedAt.get(key);
    if (last !== undefined && now - last < WARN_EVERY_MS) return;
    this.warnedAt.set(key, now);
    console.warn(`[agents] ${what}:`, err instanceof Error ? err.message : err);
  }

  /** List + stat metas, tail unfinished agents. True when the broadcast list changed. */
  poll(): Promise<boolean> {
    this.inflight ??= this.pollOnce().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async pollOnce(): Promise<boolean> {
    if (this.disposed) return false;
    let names: string[];
    try {
      names = await this.fs.readdir(this.folder);
    } catch (err) {
      // Missing is [] already; anything else (EACCES…): keep the last roster, retry next poll.
      this.warn(this.folder, `cannot list ${this.folder}`, err);
      return false;
    }
    const present = new Set<string>();
    for (const name of names) {
      const id = META_RE.exec(name)?.[1];
      if (!id) continue;
      present.add(id);
      await this.pollAgent(id, path.join(this.folder, name));
      if (this.disposed) return false;
    }
    for (const id of this.roster.keys()) if (!present.has(id)) this.roster.delete(id);
    for (const id of this.badMetas.keys()) if (!present.has(id)) this.badMetas.delete(id);
    for (const id of this.warnedAt.keys()) if (id !== this.folder && !present.has(id)) this.warnedAt.delete(id);
    return this.commit();
  }

  private async pollAgent(id: string, metaFile: string): Promise<void> {
    let st: { size: number; mtimeMs: number };
    try {
      st = await this.fs.stat(metaFile);
    } catch {
      return; // removed between readdir and stat
    }
    const sig = `${st.mtimeMs}:${st.size}`;
    let agent = this.roster.get(id);
    if (agent?.metaSig !== sig && this.badMetas.get(id) !== sig) {
      let meta: Meta | undefined;
      try {
        meta = parseMeta(await this.fs.readFile(metaFile));
      } catch {
        meta = undefined;
      }
      if (!meta) {
        // Unreadable or mid-rewrite: a known agent keeps its last good meta.
        this.badMetas.set(id, sig);
      } else {
        this.badMetas.delete(id);
        if (agent) {
          agent.meta = meta;
          agent.metaSig = sig;
        } else {
          agent = { id, meta, metaSig: sig, firstSeenAt: st.mtimeMs };
          if (!meta.finished) agent.tail = new AgentTail(path.join(this.folder, `agent-${id}.jsonl`), this.fs);
          this.roster.set(id, agent);
        }
      }
    }
    if (!agent?.tail || agent.ended) return;
    const { tail } = agent;
    try {
      if (tail.version === undefined) {
        // The version decides whether the flag will ever come: learn it from the head only.
        await tail.poll(AGENT_VERSION_PROBE_BYTES - tail.readPosition);
        if (tail.version === undefined && tail.readPosition >= AGENT_VERSION_PROBE_BYTES) {
          agent.ended ??= { status: 'finished' }; // no version in the head: an older writer
          return;
        }
      }
      if (tail.version !== undefined && !versionBelow(tail.version, AGENT_FINISHED_FLAG_MIN_VERSION)) await tail.poll();
    } catch (err) {
      // Unreadable right now (replaced mid-read, EMFILE, EACCES…): keep the last state, retry next poll.
      this.warn(id, `cannot read agent ${id}`, err);
      return;
    }
    if (agent.ended) return; // ended by failAll() / a notification during the read: the first end wins
    // The meta flag ends it; an older writer never sets the flag, so its agent is done being tailed.
    const { version } = tail;
    if (agent.meta.finished || (version !== undefined && versionBelow(version, AGENT_FINISHED_FLAG_MIN_VERSION))) {
      agent.ended = { status: 'finished' };
      return;
    }
    if (version === undefined) return; // not written yet: listed as finished until it is
    const noted = this.notified.get(`id:${id}`) ?? (agent.meta.toolUseId ? this.notified.get(`tool:${agent.meta.toolUseId}`) : undefined);
    if (noted) {
      agent.ended = noted;
      return;
    }
    if (!agent.runChecked) {
      agent.runChecked = true;
      await this.applyRunStart(agent);
    }
  }

  /** The run-start rule: an unfinished agent last written before the current process started is failed. */
  private async applyRunStart(agent: Agent): Promise<void> {
    const start = this.runStartedAt;
    if (start === undefined) return;
    let last = agent.tail?.lastAt;
    if (last === undefined) {
      try {
        last = (await this.fs.stat(path.join(this.folder, `agent-${agent.id}.jsonl`))).mtimeMs;
      } catch {
        return;
      }
    }
    if (last < start) agent.ended ??= { status: 'failed', at: last };
  }

  private statusOf(a: Agent): AgentRunStatus {
    if (a.ended) return a.ended.status;
    if (a.meta.finished || !a.tail || versionBelow(a.tail.version, AGENT_FINISHED_FLAG_MIN_VERSION)) return 'finished';
    return 'running';
  }

  private runOf(a: Agent): AgentRun {
    const { meta, tail } = a;
    const status = this.statusOf(a);
    const run: AgentRun = {
      id: a.id,
      agentType: meta.agentType,
      description: meta.description,
      background: meta.background,
      depth: meta.depth,
      startedAt: tail?.firstAt ?? a.firstSeenAt,
      status,
      outputTokens: tail?.outputTokens ?? 0,
    };
    if (meta.toolUseId) run.toolUseId = meta.toolUseId;
    if (meta.parentAgentId) run.parentAgentId = meta.parentAgentId;
    if (status !== 'running') {
      const at = tail?.lastAt ?? a.ended?.at;
      if (at !== undefined) run.finishedAt = at;
    } else if (tail?.lastAt !== undefined) {
      const quiet = this.now() - tail.lastAt;
      if (quiet >= AGENT_QUIET_MS) run.quietMinutes = Math.floor(quiet / 60_000);
    }
    if (tail?.lastStep) {
      const { name, label, status: stepStatus } = tail.lastStep;
      run.lastStep = { name, label, status: stepStatus };
    }
    return run;
  }

  /** Newest running first, then newest finished; capped at AGENT_ROSTER_CAP. */
  agents(): AgentRun[] {
    const runs = [...this.roster.values()].map((a) => this.runOf(a));
    runs.sort(
      (x, y) =>
        Number(y.status === 'running') - Number(x.status === 'running') ||
        y.startedAt - x.startedAt ||
        (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
    );
    return runs.slice(0, AGENT_ROSTER_CAP);
  }

  runningCount(): number {
    let n = 0;
    for (const a of this.roster.values()) if (this.statusOf(a) === 'running') n++;
    return n;
  }

  /** D1 fallback: a task notification ends the matching agent. True when one changed. */
  applyNotification(n: TaskNotification): boolean {
    const end: End = { status: n.status === 'completed' ? 'finished' : 'failed', at: n.at };
    // Remembered for an agent not listed yet (a restored session reads notifications before the roster).
    this.remember(`id:${n.taskId}`, end);
    if (n.toolUseId !== undefined) this.remember(`tool:${n.toolUseId}`, end);
    let ended = false;
    for (const a of this.roster.values()) {
      const matches = a.id === n.taskId || (n.toolUseId !== undefined && a.meta.toolUseId === n.toolUseId);
      if (!matches || this.statusOf(a) !== 'running') continue;
      a.ended = end;
      ended = true;
    }
    return ended && this.commit();
  }

  private remember(key: string, end: End): void {
    if (this.notified.has(key)) return; // the first end wins
    this.notified.set(key, end);
    if (this.notified.size > NOTIFIED_CAP) this.notified.delete(this.notified.keys().next().value as string);
  }

  /**
   * Exit / restart / transcript change: every running agent → failed. The
   * process that wrote them is gone, so one first seen later and last written
   * before now fails too (the run-start rule, with now as the cutoff).
   * True when any changed.
   */
  failAll(): boolean {
    const now = this.now();
    if (this.runStartedAt === undefined || this.runStartedAt < now) this.runStartedAt = now;
    let ended = false;
    for (const a of this.roster.values()) {
      if (this.statusOf(a) !== 'running') continue;
      a.ended = { status: 'failed', at: this.now() };
      ended = true;
    }
    return ended && this.commit();
  }

  dispose(): void {
    this.disposed = true;
    this.roster.clear();
    this.badMetas.clear();
    this.notified.clear();
    this.warnedAt.clear();
  }

  /** Re-hash the broadcast list. True when it differs from the last one reported. */
  private commit(): boolean {
    const next = JSON.stringify(this.agents());
    if (next === this.hash) return false;
    this.hash = next;
    return true;
  }
}
