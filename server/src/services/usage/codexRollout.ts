import os from 'os';
import path from 'path';
import { promises as fsp, realpathSync } from 'fs';
import type { PlanUsage, PlanWindow, SessionUsage } from '@argus/shared';
import { JsonlTailer, nodeTranscriptFs, type TranscriptFs } from './JsonlTailer.js';
import { epochSecondsToMs } from './PlanUsageStore.js';

/**
 * Codex usage from its session logs (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`).
 *
 * Shapes (Codex CLI 0.142):
 *   {"type":"session_meta","payload":{"id":…,"timestamp":"<ISO>","cwd":"/repo",…}}   first line
 *   {"type":"turn_context","payload":{"cwd":…,"model":"gpt-5.5",…}}
 *   {"type":"event_msg","payload":{"type":"token_count",
 *      "info":{"total_token_usage":{"input_tokens","cached_input_tokens","output_tokens",
 *              "reasoning_output_tokens","total_tokens"},
 *              "last_token_usage":{…same…},"model_context_window":258400} | null,
 *      "rate_limits":{"primary":{"used_percent":23.0,"window_minutes":43200,"resets_at":<epoch s>},
 *                     "secondary":null,…}}}
 *
 * Context % is the last turn's `total_tokens` over `model_context_window`; plan
 * usage is the newest `rate_limits`. A Codex shell is matched to its rollout by
 * the session_meta `cwd` and a start time after the shell spawned.
 */

const MAX_MODEL_LEN = 100;
/** Clock slack between Argus's spawn time and Codex's session_meta timestamp. */
const START_SLACK_MS = 5_000;
/** Bytes read from a rollout's head to find its session_meta. */
const META_HEAD_BYTES = 64 * 1024;

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** `$CODEX_HOME/sessions`, else `~/.codex/sessions`. */
export function codexSessionsRoot(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  return path.join(env.CODEX_HOME || path.join(home, '.codex'), 'sessions');
}

function codexWindow(raw: unknown, observedAt: number): PlanWindow | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { used_percent?: unknown; window_minutes?: unknown; resets_at?: unknown; resets_in_seconds?: unknown };
  if (typeof r.used_percent !== 'number' || !Number.isFinite(r.used_percent) || r.used_percent < 0) return undefined;
  const w: PlanWindow = { usedPct: Math.min(100, Math.round(r.used_percent * 10) / 10) };
  if (typeof r.window_minutes === 'number' && Number.isFinite(r.window_minutes) && r.window_minutes > 0) {
    w.windowMinutes = Math.round(r.window_minutes);
  }
  const at = epochSecondsToMs(r.resets_at);
  if (at !== undefined) w.resetsAt = at;
  // Older Codex builds wrote a relative reset instead.
  else if (typeof r.resets_in_seconds === 'number' && Number.isFinite(r.resets_in_seconds) && r.resets_in_seconds >= 0) {
    w.resetsAt = observedAt + Math.round(r.resets_in_seconds * 1000);
  }
  return w;
}

/** A token_count event's `rate_limits` → plan usage, or null when it has no usable window. */
export function parseCodexRateLimits(raw: unknown, observedAt: number): PlanUsage | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as { primary?: unknown; secondary?: unknown };
  const primary = codexWindow(r.primary, observedAt);
  const secondary = codexWindow(r.secondary, observedAt);
  if (!primary && !secondary) return null;
  const out: PlanUsage = { observedAt };
  if (primary) out.primary = primary;
  if (secondary) out.secondary = secondary;
  return out;
}

interface CodexTotals {
  input: number;
  cached: number;
  output: number;
  total: number;
}

export class CodexRolloutTailer extends JsonlTailer {
  totals?: CodexTotals;
  contextTokens?: number;
  contextWindow?: number;
  model?: string;
  plan?: PlanUsage;
  /** Set when the latest line changed `plan`; cleared by takePlan(). */
  private planDirty = false;

  constructor(file: string, fs: TranscriptFs = nodeTranscriptFs) {
    super(file, fs);
  }

  protected clear(): boolean {
    const had = this.totals !== undefined || this.model !== undefined;
    this.totals = undefined;
    this.contextTokens = undefined;
    this.contextWindow = undefined;
    this.model = undefined;
    this.plan = undefined;
    return had;
  }

  /** The plan reading seen since the last call, if any. */
  takePlan(): PlanUsage | undefined {
    if (!this.planDirty) return undefined;
    this.planDirty = false;
    return this.plan;
  }

  protected line(text: string): boolean {
    const isTokens = text.includes('"token_count"');
    if (!isTokens && !text.includes('"turn_context"')) return false;
    let entry: any;
    try {
      entry = JSON.parse(text);
    } catch {
      return false;
    }
    const payload = entry?.payload;
    if (!payload || typeof payload !== 'object') return false;

    if (entry.type === 'turn_context') {
      if (typeof payload.model !== 'string' || !payload.model) return false;
      const model = payload.model.slice(0, MAX_MODEL_LEN);
      if (model === this.model) return false;
      this.model = model;
      return true;
    }

    if (entry.type !== 'event_msg' || payload.type !== 'token_count') return false;
    let changed = false;
    const info = payload.info;
    if (info && typeof info === 'object') {
      const t = info.total_token_usage;
      if (t && typeof t === 'object') {
        this.totals = { input: num(t.input_tokens), cached: num(t.cached_input_tokens), output: num(t.output_tokens), total: num(t.total_tokens) };
        changed = true;
      }
      const last = info.last_token_usage;
      if (last && typeof last === 'object') this.contextTokens = num(last.total_tokens);
      if (num(info.model_context_window) > 0) this.contextWindow = num(info.model_context_window);
    }
    const ts = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN;
    const plan = parseCodexRateLimits(payload.rate_limits, Number.isFinite(ts) ? ts : Date.now());
    if (plan) {
      this.plan = plan;
      this.planDirty = true;
      changed = true;
    }
    return changed;
  }

  /** The session meter, or undefined before any token count was seen. */
  snapshot(updatedAt: number): SessionUsage | undefined {
    const t = this.totals;
    if (!t) return undefined;
    const usage: SessionUsage = {
      // Codex counts cached input inside input_tokens.
      inputTokens: Math.max(0, t.input - t.cached),
      outputTokens: t.output,
      cacheCreationTokens: 0,
      cacheReadTokens: t.cached,
      totalTokens: t.total || t.input + t.output,
      updatedAt,
    };
    if (this.model) usage.model = this.model;
    if (this.contextTokens !== undefined) {
      usage.contextTokens = this.contextTokens;
      if (this.contextWindow) {
        usage.contextWindow = this.contextWindow;
        usage.contextPct = Math.min(100, Math.round((this.contextTokens / this.contextWindow) * 1000) / 10);
      }
    }
    return usage;
  }
}

// ── Matching a Codex shell to its rollout file ───────────────────────────────

export interface RolloutCandidate {
  path: string;
  cwd: string;
  startedAt: number;
}

export interface RolloutWanted {
  id: string;
  cwd: string;
  spawnedAt: number;
}

/** Real path, or the input when it cannot be resolved. */
function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * `file` resolved (symlinks followed) and confined to the real `root`, or
 * undefined when it escapes it or is not a plausible rollout file name.
 */
export function confineRollout(file: string, root: string): string | undefined {
  if (!/^rollout-[A-Za-z0-9._-]+\.jsonl$/.test(path.basename(file))) return undefined;
  try {
    const r = realpathSync(root);
    const f = realpathSync(file);
    return f.startsWith(r + path.sep) ? f : undefined;
  } catch {
    return undefined;
  }
}

/** session_meta (cwd, start time) from the head of a rollout file. */
export function parseRolloutMeta(head: string): { cwd: string; startedAt: number } | undefined {
  const nl = head.indexOf('\n');
  const first = nl >= 0 ? head.slice(0, nl) : head;
  let cwd: unknown;
  let ts: unknown;
  try {
    const e = JSON.parse(first);
    if (e?.type !== 'session_meta') return undefined;
    cwd = e.payload?.cwd;
    ts = e.payload?.timestamp ?? e.timestamp;
  } catch {
    // The first line carries the base instructions and can outgrow the head
    // read; the fields we want come before them.
    if (!first.startsWith('{') || !first.includes('"session_meta"')) return undefined;
    const c = first.match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const t = first.match(/"payload"\s*:\s*\{[^{}]*?"timestamp"\s*:\s*"([^"]+)"/);
    try {
      cwd = c ? JSON.parse(`"${c[1]}"`) : undefined;
    } catch {
      cwd = undefined;
    }
    ts = t?.[1];
  }
  const startedAt = typeof ts === 'string' ? Date.parse(ts) : NaN;
  if (typeof cwd !== 'string' || !cwd || !Number.isFinite(startedAt)) return undefined;
  return { cwd, startedAt };
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Codex names its day folders in local time. */
function dayDirs(root: string, from: number, to: number): string[] {
  const out: string[] = [];
  const d = new Date(from - 24 * 3600_000); // a day of slack for timezone edges
  d.setHours(0, 0, 0, 0);
  while (d.getTime() <= to && out.length < 400) {
    out.push(path.join(root, String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate())));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/**
 * Rollout files started at or after `since`, newest days first. `seen` caches
 * files already judged (path → candidate or null) so each head is read once.
 */
export async function scanCodexRollouts(
  root: string,
  since: number,
  seen: Map<string, RolloutCandidate | null>,
  now = Date.now(),
): Promise<RolloutCandidate[]> {
  const out: RolloutCandidate[] = [];
  for (const dir of dayDirs(root, since, now)) {
    let names: string[];
    try {
      names = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) continue;
      const file = path.join(dir, name);
      if (seen.has(file)) {
        const c = seen.get(file);
        if (c && c.startedAt >= since - START_SLACK_MS) out.push(c);
        continue;
      }
      const confined = confineRollout(file, root);
      if (!confined) {
        seen.set(file, null);
        continue;
      }
      let head: string;
      try {
        const st = await fsp.stat(confined);
        if (st.mtimeMs < since - START_SLACK_MS) {
          seen.set(file, null); // written before the shell existed
          continue;
        }
        const fh = await fsp.open(confined, 'r');
        try {
          const buf = Buffer.alloc(META_HEAD_BYTES);
          const { bytesRead } = await fh.read(buf, 0, META_HEAD_BYTES, 0);
          head = buf.subarray(0, bytesRead).toString('utf8');
        } finally {
          await fh.close();
        }
      } catch {
        continue; // vanished or unreadable: try again next scan
      }
      const meta = parseRolloutMeta(head);
      if (!meta) {
        if (head.includes('\n')) seen.set(file, null); // complete first line, not a rollout
        continue; // otherwise Codex is still writing it
      }
      const c: RolloutCandidate = { path: confined, cwd: real(meta.cwd), startedAt: meta.startedAt };
      seen.set(file, c);
      if (c.startedAt >= since - START_SLACK_MS) out.push(c);
    }
  }
  return out;
}

/**
 * Pair waiting Codex shells with rollout files: same real cwd, started at or
 * after the shell spawned, not already claimed. The latest-spawned shell picks
 * first and takes the earliest file it can, so two shells in one folder each
 * get their own (an earlier shell can never take a later shell's file when
 * that later shell's file is the only one after its spawn).
 */
export function assignRollouts(
  wanted: readonly RolloutWanted[],
  candidates: readonly RolloutCandidate[],
  claimed: ReadonlySet<string>,
): Map<string, string> {
  const taken = new Set(claimed);
  const out = new Map<string, string>();
  const byStart = [...candidates].sort((a, b) => a.startedAt - b.startedAt);
  for (const w of [...wanted].sort((a, b) => b.spawnedAt - a.spawnedAt)) {
    const cwd = real(w.cwd);
    const hit = byStart.find((c) => !taken.has(c.path) && c.cwd === cwd && c.startedAt >= w.spawnedAt - START_SLACK_MS);
    if (!hit) continue;
    taken.add(hit.path);
    out.set(w.id, hit.path);
  }
  return out;
}

/** Persisted per Codex shell: when it spawned and, once matched, its rollout. */
export interface CodexUsageState {
  spawnedAt: number;
  path?: string;
}
