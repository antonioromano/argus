import { execFile } from 'child_process';
import { access } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import type { PrChecks, PrCiStatus, PrFailedCheck, PrMergeable, PrReviewDecision, PrState, SessionPr, SessionPrDiffResponse } from '@argus/shared';
import { parsePrCreateUrl } from './worktreeLifecycle.js';

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
export type GhRunner = (args: string[], cwd: string, opts?: { timeoutMs?: number; maxBuffer?: number }) => Promise<string>;

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
/** A merged or closed PR barely changes: keep it longer, so a long PR list stays cheap. */
export const PR_FINAL_TTL_MS = 30 * 60_000;
/** After `gh` turned out missing / logged out, look again this rarely. */
export const GH_UNAVAILABLE_RECHECK_MS = 10 * 60_000;
const DEFAULT_BRANCH_TTL_MS = 10 * 60_000;
const GH_TIMEOUT_MS = 8_000;
/** `gh pr create` pushes metadata to GitHub; allow it longer than a lookup. */
const PR_CREATE_TIMEOUT_MS = 60_000;
/** B4: a PR diff larger than this is not shown; only its file list is. */
export const PR_DIFF_MAX_BYTES = 8 * 1024 * 1024;
/** `gh pr diff` downloads the whole patch; allow it longer than a lookup. */
export const PR_DIFF_TIMEOUT_MS = 30_000;
/** Paths listed for a diff over the size limit — GitHub's own cap on a PR's file list. */
export const PR_DIFF_MAX_FILES = 3_000;
/** owner, repo, number of a validated github.com PR URL. */
const PR_URL_PARTS = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([0-9]+)$/;
const GH_STDOUT_MAX_BYTES = 2 * 1024 * 1024;

const PR_VIEW_FIELDS = 'number,state,isDraft,url,statusCheckRollup,headRefName,title,reviewDecision,mergeable,headRefOid';
export const PR_VIEW_ARGS = ['pr', 'view', '--json', PR_VIEW_FIELDS];
/** `gh pr view <url>`: works from any folder, so a PR in another repo resolves too. */
export const prViewArgsForUrl = (url: string): string[] => ['pr', 'view', url, '--json', PR_VIEW_FIELDS];

// ── statusCheckRollup → one aggregate ─────────────────────────────────────

const FAILED_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE']);
const FAILED_STATES = new Set(['FAILURE', 'ERROR']);
const PENDING_STATES = new Set(['PENDING', 'EXPECTED']);

/** C1: a check's outcome as the popover counts it — a skipped run is shown apart. */
type CheckOutcome = 'failed' | 'pending' | 'passed' | 'skipped';

const upper = (v: unknown): string => (typeof v === 'string' ? v.toUpperCase() : '');

/** One rollup entry: a CheckRun (`status` + `conclusion`) or a commit
 *  StatusContext (`state`). */
function checkOutcome(entry: unknown): CheckOutcome {
  const e = (entry ?? {}) as { status?: unknown; conclusion?: unknown; state?: unknown };
  const state = upper(e.state);
  if (state) {
    if (FAILED_STATES.has(state)) return 'failed';
    if (PENDING_STATES.has(state)) return 'pending';
    return 'passed';
  }
  const status = upper(e.status);
  if (status && status !== 'COMPLETED') return 'pending';
  const conclusion = upper(e.conclusion);
  if (!conclusion) return 'pending';
  if (FAILED_CONCLUSIONS.has(conclusion)) return 'failed';
  return conclusion === 'SKIPPED' ? 'skipped' : 'passed';
}

/** The aggregate of a breakdown: any failure wins, then any still-running
 *  check; neutral and skipped runs count as passing; no checks → none. */
function ciOf(checks: PrChecks | null): PrCiStatus {
  if (!checks) return 'none';
  return checks.counts.failed ? 'failure' : checks.counts.pending ? 'pending' : 'success';
}

/** The rollup reduced to one aggregate (see ciOf). */
export function aggregateChecks(rollup: unknown): PrCiStatus {
  return ciOf(summarizeChecks(rollup));
}

/** C1: failed checks listed in the CI popover; the counts still cover every one. */
export const PR_FAILED_CHECKS_MAX = 20;
const CHECK_NAME_MAX_LEN = 120;
const CHECK_URL_MAX_LEN = 500;

/** A check's display name: the run's `name` (with its workflow when it has
 *  one) or the status context's `context`. */
function checkName(e: { name?: unknown; workflowName?: unknown; context?: unknown }): string {
  const name = typeof e.name === 'string' && e.name ? e.name : typeof e.context === 'string' ? e.context : '';
  const workflow = typeof e.workflowName === 'string' ? e.workflowName : '';
  const full = workflow && name && workflow !== name ? `${workflow} / ${name}` : name || workflow || 'Unnamed check';
  return full.slice(0, CHECK_NAME_MAX_LEN);
}

/** `detailsUrl` (CheckRun) or `targetUrl` (StatusContext), https only. */
function checkUrl(e: { detailsUrl?: unknown; targetUrl?: unknown }): string | undefined {
  const url = typeof e.detailsUrl === 'string' && e.detailsUrl ? e.detailsUrl : e.targetUrl;
  return typeof url === 'string' && /^https:\/\//.test(url) && url.length <= CHECK_URL_MAX_LEN ? url : undefined;
}

/**
 * C1: the rollup broken down per outcome, plus the failed checks (bounded)
 * with a link each — compact, since it rides along every PR answer. null when
 * the PR has no checks.
 */
export function summarizeChecks(rollup: unknown): PrChecks | null {
  if (!Array.isArray(rollup) || rollup.length === 0) return null;
  const counts = { passed: 0, failed: 0, pending: 0, skipped: 0 };
  const failed: PrFailedCheck[] = [];
  for (const entry of rollup) {
    const outcome = checkOutcome(entry);
    counts[outcome]++;
    if (outcome !== 'failed' || failed.length >= PR_FAILED_CHECKS_MAX) continue;
    const e = (entry ?? {}) as Record<string, unknown>;
    const check: PrFailedCheck = { name: checkName(e) };
    const url = checkUrl(e);
    if (url) check.url = url;
    failed.push(check);
  }
  return { counts, failed };
}

function prState(state: unknown, isDraft: unknown): PrState {
  const s = typeof state === 'string' ? state.toUpperCase() : '';
  if (s === 'MERGED') return 'merged';
  if (s === 'CLOSED') return 'closed';
  return isDraft === true ? 'draft' : 'open';
}

const MAX_TITLE_LEN = 300;

function reviewDecision(v: unknown): PrReviewDecision | undefined {
  if (typeof v !== 'string') return undefined;
  switch (v.toUpperCase()) {
    case 'APPROVED': return 'approved';
    case 'CHANGES_REQUESTED': return 'changes_requested';
    case 'REVIEW_REQUIRED': return 'review_required';
    default: return 'none'; // gh prints "" when no review is required
  }
}

function mergeable(v: unknown): PrMergeable | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.toUpperCase();
  return s === 'MERGEABLE' ? 'mergeable' : s === 'CONFLICTING' ? 'conflicting' : 'unknown';
}

/** Parse `gh pr view --json …` output; null when it is not a usable PR. */
export function parsePrView(stdout: string): SessionPr | null {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return null;
  }
  const o = raw as {
    number?: unknown; state?: unknown; isDraft?: unknown; url?: unknown; statusCheckRollup?: unknown; headRefName?: unknown;
    title?: unknown; reviewDecision?: unknown; mergeable?: unknown; headRefOid?: unknown;
  };
  if (!o || typeof o.number !== 'number' || typeof o.url !== 'string' || !/^https:\/\//.test(o.url)) return null;
  const checks = summarizeChecks(o.statusCheckRollup);
  const pr: SessionPr = {
    number: o.number,
    state: prState(o.state, o.isDraft),
    url: o.url,
    ci: ciOf(checks),
    branch: typeof o.headRefName === 'string' ? o.headRefName : '',
  };
  if (typeof o.title === 'string') pr.title = o.title.slice(0, MAX_TITLE_LEN);
  const review = reviewDecision(o.reviewDecision);
  if (review) pr.review = review;
  const merge = mergeable(o.mergeable);
  if (merge) pr.mergeable = merge;
  if (checks) pr.checks = checks;
  if (typeof o.headRefOid === 'string' && /^[0-9a-f]{7,64}$/i.test(o.headRefOid)) pr.headSha = o.headRefOid.toLowerCase();
  return pr;
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

/** Why a PR diff couldn't be read: gh missing / logged out, too slow, or it failed. */
export class PrDiffError extends Error {
  constructor(readonly kind: 'unavailable' | 'timeout' | 'failed', message: string) {
    super(message);
  }
}

/** execFile killed the child for exceeding `maxBuffer`. */
const isMaxBuffer = (err: unknown): boolean =>
  (err as { code?: unknown })?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';

/** execFile killed the child for exceeding `timeout`. */
const isTimeout = (err: unknown): boolean => {
  const e = (err ?? {}) as { killed?: unknown; signal?: unknown };
  return e.killed === true && e.signal === 'SIGTERM';
};

/** gh's own explanation (first stderr line), short enough for a UI message. */
function ghMessage(err: unknown): string {
  const e = (err ?? {}) as { stderr?: unknown; message?: unknown };
  const line = typeof e.stderr === 'string' ? e.stderr.trim().split('\n')[0] : '';
  return (line || (typeof e.message === 'string' ? e.message : 'gh failed')).slice(0, 300);
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
  return async (args, cwd, opts) => {
    ghPath ??= findGh();
    const bin = await ghPath;
    if (!bin) {
      ghPath = null; // re-resolve next time: gh may get installed later
      throw Object.assign(new Error('gh not found'), { code: 'ENOENT' });
    }
    return new Promise<string>((resolve, reject) => {
      execFile(bin, args, {
        cwd,
        timeout: opts?.timeoutMs ?? GH_TIMEOUT_MS,
        maxBuffer: opts?.maxBuffer ?? GH_STDOUT_MAX_BYTES,
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
  private diffInflight = new Map<string, Promise<SessionPrDiffResponse>>();
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
  lookup(gitRoot: string, branch: string, cwd: string): Promise<SessionPr | null> {
    return this.cached(`${gitRoot}\0${branch}`, PR_VIEW_ARGS, cwd);
  }

  /**
   * A PR by its URL — the one a session's transcript says it worked on, which
   * may live in a different repo than the session folder. The caller passes a
   * validated github.com PR URL. Never throws.
   */
  async forUrl(url: string, cwd: string): Promise<SessionPr | null> {
    if (this.now() < this.unavailableUntil) return null;
    try {
      return await this.cached(`url\0${url}`, prViewArgsForUrl(url), cwd);
    } catch {
      return null;
    }
  }

  private async cached(key: string, args: string[], cwd: string): Promise<SessionPr | null> {
    const hit = this.cache.get(key);
    if (hit && this.now() < hit.expiresAt) return hit.value;
    const running = this.inflight.get(key);
    if (running) return running;
    const p = this.fetch(key, args, cwd).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  /**
   * Beta F8: is `gh` installed and logged in? Asked only when the Finish sheet
   * opens, never polled. Shares the "unavailable" back-off with the PR chips.
   */
  async ghAvailable(cwd: string): Promise<boolean> {
    if (this.now() < this.unavailableUntil) return false;
    try {
      await this.runGh(['auth', 'status'], cwd);
      return true;
    } catch (err) {
      if (isGhUnavailable(err)) this.unavailableUntil = this.now() + GH_UNAVAILABLE_RECHECK_MS;
      return false;
    }
  }

  /**
   * Beta F8: `gh pr create --fill` for `branch` against `base`. Resolves the
   * PR URL; rejects with gh's error. Drops the cached lookup so the chip picks
   * the new PR up on the next sweep. Both refs are validated by the caller.
   */
  async createPr(gitRoot: string, cwd: string, branch: string, base: string): Promise<string> {
    const stdout = await this.runGh(
      ['pr', 'create', '--fill', '--base', base, '--head', branch],
      cwd,
      { timeoutMs: PR_CREATE_TIMEOUT_MS },
    );
    this.cache.delete(`${gitRoot}\0${branch}`);
    const url = parsePrCreateUrl(stdout);
    if (!url) throw new Error(stdout.trim() || 'gh pr create printed no PR URL');
    return url;
  }

  /**
   * B4: `gh pr diff <url>` — every changed file of one PR as a raw unified
   * diff. Not cached: it is asked for only when the user opens the diff, but
   * a run already in flight for the same PR is shared (repeated Refresh, two
   * windows). Over PR_DIFF_MAX_BYTES only the changed paths come back. The
   * caller passes a validated github.com PR URL. Rejects with PrDiffError.
   */
  prDiff(url: string, cwd: string): Promise<SessionPrDiffResponse> {
    const key = url.toLowerCase();
    const running = this.diffInflight.get(key);
    if (running) return running;
    const p = this.readPrDiff(url, cwd).finally(() => this.diffInflight.delete(key));
    this.diffInflight.set(key, p);
    return p;
  }

  private async readPrDiff(url: string, cwd: string): Promise<SessionPrDiffResponse> {
    if (this.now() < this.unavailableUntil) throw new PrDiffError('unavailable', 'GitHub CLI (gh) is missing or not logged in');
    try {
      const diff = await this.runGh(['pr', 'diff', url, '--color', 'never'], cwd, {
        timeoutMs: PR_DIFF_TIMEOUT_MS, maxBuffer: PR_DIFF_MAX_BYTES,
      });
      return { url, diff };
    } catch (err) {
      if (isMaxBuffer(err)) return { url, diff: '', truncated: { ...(await this.prFileNames(url, cwd)), limitBytes: PR_DIFF_MAX_BYTES } };
      if (isGhUnavailable(err)) {
        this.unavailableUntil = this.now() + GH_UNAVAILABLE_RECHECK_MS;
        throw new PrDiffError('unavailable', 'GitHub CLI (gh) is missing or not logged in');
      }
      if (isTimeout(err)) throw new PrDiffError('timeout', `gh pr diff took longer than ${PR_DIFF_TIMEOUT_MS / 1000}s`);
      throw new PrDiffError('failed', ghMessage(err));
    }
  }

  /**
   * Changed paths of a PR whose diff is too large to show, from the REST file
   * list (`gh api …/pulls/{n}/files --paginate`) — not `gh pr diff
   * --name-only`, which downloads the whole patch again, nor `gh pr view
   * --json files`, which stops at 100. GitHub itself lists at most
   * PR_DIFF_MAX_FILES, so a list that long, or a failed one, is not `complete`.
   */
  private async prFileNames(url: string, cwd: string): Promise<{ files: string[]; complete: boolean }> {
    const m = PR_URL_PARTS.exec(url);
    if (!m) return { files: [], complete: false };
    try {
      const out = await this.runGh(
        ['api', '--paginate', `repos/${m[1]}/${m[2]}/pulls/${m[3]}/files?per_page=100`, '--jq', '.[].filename'],
        cwd,
        { timeoutMs: PR_DIFF_TIMEOUT_MS, maxBuffer: PR_DIFF_MAX_BYTES },
      );
      const files = out.split('\n').map((l) => l.trim()).filter(Boolean);
      return { files: files.slice(0, PR_DIFF_MAX_FILES), complete: files.length < PR_DIFF_MAX_FILES };
    } catch {
      return { files: [], complete: false };
    }
  }

  /** Forget everything (the feature was switched off). */
  clear(): void {
    this.cache.clear();
    this.defaultBranches.clear();
  }

  private async fetch(key: string, args: string[], cwd: string): Promise<SessionPr | null> {
    if (this.now() < this.unavailableUntil) return null;
    let value: SessionPr | null = null;
    try {
      value = parsePrView(await this.runGh(args, cwd));
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
      ? (value.ci === 'pending' || value.mergeable === 'unknown' ? PR_PENDING_TTL_MS : PR_SETTLED_TTL_MS)
      : value ? PR_FINAL_TTL_MS : PR_SETTLED_TTL_MS;
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
