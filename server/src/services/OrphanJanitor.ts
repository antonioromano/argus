import { execFile } from 'child_process';
import type { OrphanAgent, OrphanDaemon, OrphanKillResponse, OrphanReport } from '@argus/shared';

/**
 * F16 — the orphan/duplicate agent janitor. Three layers stop a second daemon
 * from serving this data dir (chooseDaemonSocket, the argusd flock, dev env
 * forcing); this is the user-facing cleanup for when one slips through anyway.
 *
 * Scope is deliberately narrow so it can never reach another Argus instance:
 *  - argusd processes whose socket argument lives in THIS data dir, except the
 *    active socket;
 *  - the tmux server for THIS app's label (`tmux -L <label>`), only while the
 *    active backend is not tmux.
 * Packaged and dev builds use different data dirs and tmux labels, so neither
 * ever lists the other's agents.
 */

export interface PsRow {
  pid: number;
  ppid: number;
  rssKb: number;
  command: string;
}

export interface JanitorContext {
  dataDir: string;
  /** Socket of the active argusd backend, or null when the backend is not argusd. */
  activeSocket: string | null;
  /** Pid of the active daemon, when known (its .sock.pid file). Never listed. */
  activeDaemonPid: number | null;
  /** This app's tmux label (ARGUS_TMUX_SOCKET). */
  tmuxLabel: string;
  /** True when tmux is the active backend: then its server is not an orphan. */
  tmuxActive: boolean;
  /** Our own pid: it and its ancestors are never listed. */
  selfPid: number;
}

const AGENTS = new Set(['claude', 'gemini', 'codex']);
const RUNTIMES = new Set(['node', 'bun']);
const SESSION_ID_RE = /\/signals\/([0-9a-fA-F-]{36})\.json/;

/** Parse `ps -axo pid,ppid,rss,command` (header optional). Malformed lines are skipped. */
export function parsePs(out: string): PsRow[] {
  const rows: PsRow[] = [];
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*\S)\s*$/.exec(line);
    if (!m) continue;
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), rssKb: Number(m[3]), command: m[4] });
  }
  return rows;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function basename(token: string): string {
  return token.slice(token.lastIndexOf('/') + 1);
}

/** The agent name a command runs (`claude …`, `node /x/gemini …`), or null. */
export function agentOf(command: string): string | null {
  const [first = '', second = ''] = command.split(/\s+/);
  const a = basename(first);
  if (AGENTS.has(a)) return a;
  if (RUNTIMES.has(a) && AGENTS.has(basename(second))) return basename(second);
  return null;
}

interface Root { kind: 'argusd' | 'tmux'; label: string; pid: number; socket?: string }

/** argusd / tmux-server processes that belong to this app, active or not. */
function findRoots(rows: PsRow[], ctx: JanitorContext): Root[] {
  const daemonRe = new RegExp(
    `(?:^|/)argusd(?:-[\\w]+)?\\s+(${escapeRe(ctx.dataDir.replace(/\/+$/, ''))}/argusd-(.+?)\\.sock)$`,
  );
  const tmuxRe = new RegExp(`(?:^|/)tmux\\s(?:.*\\s)?-L\\s*${escapeRe(ctx.tmuxLabel)}(?:\\s|$)`);
  const roots: Root[] = [];
  for (const r of rows) {
    const d = daemonRe.exec(r.command);
    if (d) {
      roots.push({ kind: 'argusd', label: d[2], pid: r.pid, socket: d[1] });
      continue;
    }
    // The tmux server daemonizes (ppid 1); clients (`tmux -L x attach`) don't.
    if (r.ppid === 1 && tmuxRe.test(r.command)) {
      roots.push({ kind: 'tmux', label: ctx.tmuxLabel, pid: r.pid });
    }
  }
  return roots;
}

function isActive(root: Root, ctx: JanitorContext): boolean {
  if (root.kind === 'tmux') return ctx.tmuxActive;
  return root.socket === ctx.activeSocket || root.pid === ctx.activeDaemonPid;
}

function childrenIndex(rows: PsRow[]): Map<number, PsRow[]> {
  const kids = new Map<number, PsRow[]>();
  for (const r of rows) {
    if (r.pid === r.ppid) continue;
    const list = kids.get(r.ppid);
    if (list) list.push(r);
    else kids.set(r.ppid, [r]);
  }
  return kids;
}

/** `pid` and every descendant, parents before children. */
export function processTree(rows: PsRow[], pid: number): number[] {
  const kids = childrenIndex(rows);
  const out: number[] = [];
  const seen = new Set<number>();
  const stack = [pid];
  while (stack.length) {
    const p = stack.shift()!;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    for (const k of kids.get(p) ?? []) stack.push(k.pid);
  }
  return out;
}

function ancestorsOf(rows: PsRow[], pid: number): Set<number> {
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const out = new Set<number>([pid]);
  let cur = byPid.get(pid);
  while (cur && cur.ppid > 1 && !out.has(cur.ppid)) {
    out.add(cur.ppid);
    cur = byPid.get(cur.ppid);
  }
  return out;
}

/**
 * Classify a ps snapshot. Pure: the active daemon, the active tmux server, our
 * own process and its ancestors are never in the result.
 */
export function classifyOrphans(rows: PsRow[], ctx: JanitorContext): OrphanReport {
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const protectedPids = ancestorsOf(rows, ctx.selfPid);
  const daemons: OrphanDaemon[] = [];
  const agents: OrphanAgent[] = [];

  for (const root of findRoots(rows, ctx)) {
    if (isActive(root, ctx) || protectedPids.has(root.pid)) continue;
    const tree = processTree(rows, root.pid);
    if (tree.some((p) => protectedPids.has(p))) continue; // we run inside it: never offer it
    const sessionIds = new Set<string>();
    const agentPids = new Set<number>();
    for (const pid of tree.slice(1)) {
      const row = byPid.get(pid)!;
      const agent = agentOf(row.command);
      if (!agent || agentPids.has(row.ppid)) {
        if (agent) agentPids.add(pid); // nested helper of an agent: counted in its tree
        continue;
      }
      agentPids.add(pid);
      const sessionId = SESSION_ID_RE.exec(row.command)?.[1] ?? null;
      if (sessionId) sessionIds.add(sessionId);
      agents.push({ pid, agent, command: row.command, cwd: null, rssKb: row.rssKb, daemonPid: root.pid, sessionId });
    }
    daemons.push({
      kind: root.kind,
      label: root.label,
      pid: root.pid,
      alive: true,
      sessionIds: [...sessionIds],
      childPids: tree.slice(1),
      treeRssKb: tree.reduce((sum, p) => sum + (byPid.get(p)?.rssKb ?? 0), 0),
    });
  }

  return { daemons, agents, totalRssKb: daemons.reduce((s, d) => s + d.treeRssKb, 0) };
}

/**
 * The kill guard. Only a pid that is a listed orphan daemon or agent in a
 * FRESH report is accepted; anything else is rejected without a signal. The
 * targets are each accepted pid plus its descendants.
 */
export function validateKillRequest(
  requested: unknown,
  report: OrphanReport,
  rows: PsRow[],
): { accepted: number[]; rejected: number[]; targets: number[] } {
  const allowed = new Set<number>([...report.daemons.map((d) => d.pid), ...report.agents.map((a) => a.pid)]);
  const list = Array.isArray(requested) ? requested : [];
  const accepted: number[] = [];
  const rejected: number[] = [];
  for (const p of list) {
    if (typeof p === 'number' && Number.isInteger(p) && allowed.has(p)) {
      if (!accepted.includes(p)) accepted.push(p);
    } else if (typeof p === 'number') {
      rejected.push(p);
    }
  }
  const targets = new Set<number>();
  for (const p of accepted) for (const t of processTree(rows, p)) targets.add(t);
  return { accepted, rejected, targets: [...targets] };
}

// ---------------------------------------------------------------------------
// Impure layer: ps, lsof, signals.

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024, timeout: 5_000 }, (_err, stdout) => {
      resolve(typeof stdout === 'string' ? stdout : ''); // lsof exits 1 on any missing pid; keep what it printed
    });
  });
}

export async function readPs(): Promise<PsRow[]> {
  return parsePs(await run('ps', ['-axo', 'pid,ppid,rss,command']));
}

/** Parse `lsof -Fpn` output into pid → cwd. */
export function parseLsofCwd(out: string): Map<number, string> {
  const map = new Map<number, string>();
  let pid = 0;
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid) map.set(pid, line.slice(1));
  }
  return map;
}

async function readCwds(pids: number[]): Promise<Map<number, string>> {
  if (pids.length === 0) return new Map();
  return parseLsofCwd(await run('lsof', ['-a', '-d', 'cwd', '-p', pids.join(','), '-Fpn']));
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface JanitorDeps {
  context: () => JanitorContext;
  readPs?: () => Promise<PsRow[]>;
  readCwds?: (pids: number[]) => Promise<Map<number, string>>;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  isAlive?: (pid: number) => boolean;
  sleep?: (ms: number) => Promise<void>;
  graceMs?: number;
}

export class OrphanJanitor {
  constructor(private deps: JanitorDeps) {}

  private snapshot(): Promise<PsRow[]> {
    return (this.deps.readPs ?? readPs)();
  }

  async list(): Promise<OrphanReport> {
    const report = classifyOrphans(await this.snapshot(), this.deps.context());
    const cwds = await (this.deps.readCwds ?? readCwds)(report.agents.map((a) => a.pid));
    for (const a of report.agents) a.cwd = cwds.get(a.pid) ?? null;
    return report;
  }

  /** SIGTERM each validated tree, SIGKILL whatever survives the grace period. */
  async kill(requested: unknown): Promise<OrphanKillResponse> {
    const rows = await this.snapshot();
    const report = classifyOrphans(rows, this.deps.context());
    const { accepted, rejected, targets } = validateKillRequest(requested, report, rows);
    const kill = this.deps.kill ?? ((pid, sig) => process.kill(pid, sig));
    const isAlive = this.deps.isAlive ?? alive;
    const signalled: number[] = [];
    // Children first, so an argusd that notices a dying child can't respawn it.
    for (const pid of [...targets].reverse()) {
      try {
        kill(pid, 'SIGTERM');
        signalled.push(pid);
      } catch { /* already gone */ }
    }
    const forceKilled: number[] = [];
    if (signalled.length) {
      await (this.deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(this.deps.graceMs ?? 2_000);
      // Re-check against a fresh snapshot: only a pid still running the same
      // command gets SIGKILL, so a pid reused during the grace period is spared.
      const before = new Map(rows.map((r) => [r.pid, r.command]));
      const after = new Map((await this.snapshot()).map((r) => [r.pid, r.command]));
      for (const pid of signalled) {
        if (!isAlive(pid) || after.get(pid) !== before.get(pid)) continue;
        try {
          kill(pid, 'SIGKILL');
          forceKilled.push(pid);
        } catch { /* exited meanwhile */ }
      }
    }
    return { accepted, rejected, signalled, forceKilled };
  }
}
