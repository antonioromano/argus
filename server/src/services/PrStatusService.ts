import { execFile } from 'child_process';
import { access } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import type { PrCiStatus, PrState, SessionPr } from '@argus/shared';

/**
 * PR / CI state of a session's branch, read with the GitHub CLI
 * (`gh pr view --json …`). Optional by design: when `gh` is missing or not
 * logged in, every lookup quietly answers null and the feature goes dormant —
 * no error spam, no retry storm.
 *
 * Lookups are deduped per (gitRoot, branch) — several sessions on one branch
 * share one `gh` call — and cached: briefly while a check is still running, so
 * the chip turns green/red soon after CI finishes, and longer otherwise.
 */

/** `gh pr view` in `cwd`. Resolves stdout; rejects with the execFile error
 *  (carrying `code` and `stderr`) on a non-zero exit or a missing binary. */
export type GhRunner = (args: string[], cwd: string) => Promise<string>;

/** Current branch and repo root of a folder; null when not a repo / detached. */
export interface HeadInfo {
  root: string;
  branch: string;
}

export interface PrStatusDeps {
  runGh?: GhRunner;
  /** Branch + repo root of `folder` (null: not a repo or detached HEAD). */
  headInfo: (folder: string) => Promise<HeadInfo | null>;
  /** The repo's default branch (`main`, `master`, …). */
  defaultBranch: (root: string) => Promise<string>;
  now?: () => number;
}

export const PR_PENDING_TTL_MS = 60_000;
export const PR_SETTLED_TTL_MS = 5 * 60_000;
/** After `gh` turned out missing / logged out, look again this rarely. */
export const GH_UNAVAILABLE_RECHECK_MS = 10 * 60_000;
const DEFAULT_BRANCH_TTL_MS = 10 * 60_000;
const GH_TIMEOUT_MS = 8_000;

export const PR_VIEW_ARGS = ['pr', 'view', '--json', 'number,state,isDraft,url,statusCheckRollup,headRefName'];

// ── statusCheckRollup → one aggregate ─────────────────────────────────────

const FAILED_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE']);
const FAILED_STATES = new Set(['FAILURE', 'ERROR']);
const PENDING_STATES = new Set(['PENDING', 'EXPECTED']);

type CheckVerdict = 'failure' | 'pending' | 'success';

/** One rollup entry: a CheckRun (`status` + `conclusion`) or a commit
 *  StatusContext (`state`). Neutral and skipped runs count as passing. */
function checkVerdict(entry: unknown): CheckVerdict {
  const e = (entry ?? {}) as { status?: unknown; conclusion?: unknown; state?: unknown };
  const upper = (v: unknown): string => (typeof v === 'string' ? v.toUpperCase() : '');
  const state = upper(e.state);
  if (state) {
    if (FAILED_STATES.has(state)) return 'failure';
    if (PENDING_STATES.has(state)) return 'pending';
    return 'success';
  }
  const status = upper(e.status);
  if (status && status !== 'COMPLETED') return 'pending';
  const conclusion = upper(e.conclusion);
  if (!conclusion) return 'pending';
  return FAILED_CONCLUSIONS.has(conclusion) ? 'failure' : 'success';
}

/** Any failure wins, then any still-running check; no checks at all → none. */
export function aggregateChecks(rollup: unknown): PrCiStatus {
  if (!Array.isArray(rollup) || rollup.length === 0) return 'none';
  let pending = false;
  for (const entry of rollup) {
    const v = checkVerdict(entry);
    if (v === 'failure') return 'failure';
    if (v === 'pending') pending = true;
  }
  return pending ? 'pending' : 'success';
}

function prState(state: unknown, isDraft: unknown): PrState {
  const s = typeof state === 'string' ? state.toUpperCase() : '';
  if (s === 'MERGED') return 'merged';
  if (s === 'CLOSED') return 'closed';
  return isDraft === true ? 'draft' : 'open';
}

/** Parse `gh pr view --json …` output; null when it is not a usable PR. */
export function parsePrView(stdout: string): SessionPr | null {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return null;
  }
  const o = raw as { number?: unknown; state?: unknown; isDraft?: unknown; url?: unknown; statusCheckRollup?: unknown; headRefName?: unknown };
  if (!o || typeof o.number !== 'number' || typeof o.url !== 'string' || !/^https:\/\//.test(o.url)) return null;
  return {
    number: o.number,
    state: prState(o.state, o.isDraft),
    url: o.url,
    ci: aggregateChecks(o.statusCheckRollup),
    branch: typeof o.headRefName === 'string' ? o.headRefName : '',
  };
}

/** `gh` cannot be used at all (missing binary or not logged in), as opposed
 *  to "this branch has no PR" or a one-off network failure. */
export function isGhUnavailable(err: unknown): boolean {
  const e = (err ?? {}) as { code?: unknown; stderr?: unknown };
  if (e.code === 'ENOENT' || e.code === 'EACCES') return true;
  // gh exits 4 when authentication is required.
  if (e.code === 4) return true;
  const stderr = typeof e.stderr === 'string' ? e.stderr : '';
  return /gh auth login|not logged in|authentication required/i.test(stderr);
}

// ── the gh binary ─────────────────────────────────────────────────────────

const GH_CANDIDATES = ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh'];

/** `gh` on PATH, else a common install location. A packaged app inherits the
 *  launchd PATH, which often lacks Homebrew — hence the fallbacks. */
async function findGh(): Promise<string | null> {
  const viaWhich = await new Promise<string | null>((resolve) => {
    execFile('which', ['gh'], { timeout: 2_000, encoding: 'utf-8' }, (err, stdout) => {
      resolve(err ? null : stdout.trim() || null);
    });
  });
  if (viaWhich) return viaWhich;
  for (const p of GH_CANDIDATES) {
    try {
      await access(p, fsConstants.X_OK);
      return p;
    } catch { /* next */ }
  }
  return null;
}

/** The real runner: execFile with an argument array (no shell) and a timeout. */
export function createGhRunner(): GhRunner {
  let ghPath: Promise<string | null> | null = null;
  return async (args, cwd) => {
    ghPath ??= findGh();
    const bin = await ghPath;
    if (!bin) {
      ghPath = null; // re-resolve next time: gh may get installed later
      throw Object.assign(new Error('gh not found'), { code: 'ENOENT' });
    }
    return new Promise<string>((resolve, reject) => {
      execFile(bin, args, {
        cwd,
        timeout: GH_TIMEOUT_MS,
        maxBuffer: 2 * 1024 * 1024,
        encoding: 'utf-8',
        env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' },
      }, (err, stdout, stderr) => {
        if (err) reject(Object.assign(err, { stderr }));
        else resolve(stdout);
      });
    });
  };
}

// ── the service ───────────────────────────────────────────────────────────

interface CacheEntry {
  value: SessionPr | null;
  expiresAt: number;
}

export class PrStatusService {
  private readonly runGh: GhRunner;
  private readonly headInfo: PrStatusDeps['headInfo'];
  private readonly defaultBranchOf: PrStatusDeps['defaultBranch'];
  private readonly now: () => number;
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<SessionPr | null>>();
  private defaultBranches = new Map<string, { branch: string; at: number }>();
  /** Epoch ms until which `gh` is considered unusable (missing / logged out). */
  private unavailableUntil = 0;
  private warned = false;

  constructor(deps: PrStatusDeps) {
    this.runGh = deps.runGh ?? createGhRunner();
    this.headInfo = deps.headInfo;
    this.defaultBranchOf = deps.defaultBranch;
    this.now = deps.now ?? Date.now;
  }

  /** PR of the branch checked out in `folder`, or null (no repo, default
   *  branch, detached HEAD, no PR, or `gh` unavailable). Never throws. */
  async forFolder(folder: string): Promise<SessionPr | null> {
    if (this.now() < this.unavailableUntil) return null;
    try {
      const head = await this.headInfo(folder);
      if (!head || !head.branch || head.branch === 'HEAD') return null;
      if (head.branch === (await this.defaultBranch(head.root))) return null;
      return await this.lookup(head.root, head.branch, folder);
    } catch {
      return null;
    }
  }

  /** Cached, deduped `gh pr view` for one (gitRoot, branch), run in `cwd`. */
  async lookup(gitRoot: string, branch: string, cwd: string): Promise<SessionPr | null> {
    const key = `${gitRoot}\0${branch}`;
    const hit = this.cache.get(key);
    if (hit && this.now() < hit.expiresAt) return hit.value;
    const running = this.inflight.get(key);
    if (running) return running;
    const p = this.fetch(key, cwd).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  /** Forget everything (the feature was switched off). */
  clear(): void {
    this.cache.clear();
    this.defaultBranches.clear();
  }

  private async fetch(key: string, cwd: string): Promise<SessionPr | null> {
    if (this.now() < this.unavailableUntil) return null;
    let value: SessionPr | null = null;
    try {
      value = parsePrView(await this.runGh(PR_VIEW_ARGS, cwd));
    } catch (err) {
      if (isGhUnavailable(err)) {
        this.unavailableUntil = this.now() + GH_UNAVAILABLE_RECHECK_MS;
        if (!this.warned) {
          this.warned = true;
          console.info('[pr-status] gh CLI missing or not logged in; PR chips are off until it is available');
        }
        return null;
      }
      // "no pull requests found", a non-GitHub remote, a network blip: no chip,
      // and don't ask again until the settled TTL runs out.
    }
    const ttl = value?.state === 'open' || value?.state === 'draft'
      ? (value.ci === 'pending' ? PR_PENDING_TTL_MS : PR_SETTLED_TTL_MS)
      : PR_SETTLED_TTL_MS;
    this.cache.set(key, { value, expiresAt: this.now() + ttl });
    return value;
  }

  private async defaultBranch(root: string): Promise<string> {
    const hit = this.defaultBranches.get(root);
    if (hit && this.now() - hit.at < DEFAULT_BRANCH_TTL_MS) return hit.branch;
    const branch = await this.defaultBranchOf(root);
    this.defaultBranches.set(root, { branch, at: this.now() });
    return branch;
  }
}
