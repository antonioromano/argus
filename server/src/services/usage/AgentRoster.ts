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
 * `finished`, a task notification, or `failAll()`; the first end wins. Agents
 * already finished at first sight are listed from meta alone and never tailed.
 */

/** First Claude Code version that writes `finished` into an agent's meta file. */
export const AGENT_FINISHED_FLAG_MIN_VERSION = '2.1.301';
/** A running agent whose jsonl has not grown for this long reports `quietMinutes`. */
export const AGENT_QUIET_MS = 5 * 60_000;
/** Most agents in the broadcast list. */
export const AGENT_ROSTER_CAP = 20;

const META_RE = /^agent-([A-Za-z0-9]{6,64})\.meta\.json$/;
const MAX_DESCRIPTION = 200;
const MAX_FIELD = 128;
/** Message ids remembered for output-token dedup (streamed entries repeat one message). */
const SEEN_CAP = 512;

export interface AgentRosterOpts {
  fs?: TranscriptFs;
  now?: () => number;
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
  ended?: { status: Exclude<AgentRunStatus, 'running'>; at?: number };
}

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
  private hash = '[]';
  private inflight?: Promise<boolean>;
  private disposed = false;

  constructor(private readonly folder: string, opts: AgentRosterOpts = {}) {
    this.fs = opts.fs ?? nodeTranscriptFs;
    this.now = opts.now ?? Date.now;
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
    } catch {
      return false; // missing is [] already; anything else: keep the last roster, retry next poll
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
    try {
      await agent.tail.poll();
    } catch {
      return; // unreadable right now (replaced mid-read, EMFILE…): keep the last state, retry next poll
    }
    if (agent.ended) return; // ended by failAll() / a notification during the read: the first end wins
    // The meta flag ends it; an older writer never sets the flag, so its agent is done being tailed.
    const { version } = agent.tail;
    if (agent.meta.finished || (version !== undefined && versionBelow(version, AGENT_FINISHED_FLAG_MIN_VERSION))) {
      agent.ended = { status: 'finished' };
    }
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
    let ended = false;
    for (const a of this.roster.values()) {
      const matches = a.id === n.taskId || (n.toolUseId !== undefined && a.meta.toolUseId === n.toolUseId);
      if (!matches || this.statusOf(a) !== 'running') continue;
      a.ended = { status: n.status === 'completed' ? 'finished' : 'failed', at: n.at };
      ended = true;
    }
    return ended && this.commit();
  }

  /** Exit / restart / transcript change: every running agent → failed. True when any changed. */
  failAll(): boolean {
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
  }

  /** Re-hash the broadcast list. True when it differs from the last one reported. */
  private commit(): boolean {
    const next = JSON.stringify(this.agents());
    if (next === this.hash) return false;
    this.hash = next;
    return true;
  }
}
