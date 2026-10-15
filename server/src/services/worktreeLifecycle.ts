import type { WorktreeFinishStep, WorktreeFinishStepResult } from '@argus/shared';

/**
 * Beta F8 — worktree lifecycle. The pure parts: step ordering and the
 * stop-on-first-failure runner, the removal guard, the stale computation, and
 * the small parsers the routes need. Everything that touches git or `gh` is
 * injected, so all of this is testable without a repo.
 */

/** Steps always run in this order, whatever order the request listed them in. */
export const FINISH_STEP_ORDER: readonly WorktreeFinishStep[] = ['commit', 'push', 'pr'];

export function isFinishStep(v: unknown): v is WorktreeFinishStep {
  return typeof v === 'string' && (FINISH_STEP_ORDER as readonly string[]).includes(v);
}

export interface StepOutcome {
  ok: boolean;
  detail?: string;
  url?: string;
}

export type StepExecutors = Record<WorktreeFinishStep, () => Promise<StepOutcome>>;

/**
 * Run the requested steps in canonical order. The first failure (a not-ok
 * outcome or a throw) stops the run: every later step is reported `skipped`
 * and its executor is never called. Duplicates are ignored.
 */
export async function runFinishSteps(
  steps: readonly WorktreeFinishStep[],
  executors: StepExecutors,
): Promise<WorktreeFinishStepResult[]> {
  const wanted = FINISH_STEP_ORDER.filter((s) => steps.includes(s));
  const results: WorktreeFinishStepResult[] = [];
  let failed = false;
  for (const step of wanted) {
    if (failed) {
      results.push({ step, status: 'skipped' });
      continue;
    }
    let outcome: StepOutcome;
    try {
      outcome = await executors[step]();
    } catch (err) {
      outcome = { ok: false, detail: errorText(err) };
    }
    results.push({
      step,
      status: outcome.ok ? 'ok' : 'failed',
      ...(outcome.detail ? { detail: outcome.detail } : {}),
      ...(outcome.url ? { url: outcome.url } : {}),
    });
    if (!outcome.ok) failed = true;
  }
  return results;
}

/** stderr first (git and gh put the useful part there), then the message. */
export function errorText(err: unknown): string {
  const e = (err ?? {}) as { stderr?: unknown; message?: unknown };
  const stderr = typeof e.stderr === 'string' ? e.stderr.trim() : '';
  if (stderr) return stderr;
  return typeof e.message === 'string' && e.message ? e.message : String(err);
}

// ── stale ─────────────────────────────────────────────────────────────────

export const STALE_AFTER_DAYS = 15;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days since the branch's last commit when that is at least
 *  `thresholdDays`; null when fresh or unknown (no commit time). */
export function staleDays(lastCommitMs: number | null, now: number, thresholdDays = STALE_AFTER_DAYS): number | null {
  if (lastCommitMs === null || !Number.isFinite(lastCommitMs)) return null;
  const days = Math.floor((now - lastCommitMs) / DAY_MS);
  return days >= thresholdDays ? days : null;
}

// ── removal ───────────────────────────────────────────────────────────────

export interface RemovalFacts {
  /** Uncommitted (or untracked) changes in the worktree. */
  dirty: boolean;
  /** The branch's PR is merged (from the F7 PR status). */
  prMerged: boolean;
  /** The branch has no commits outside the default branch. */
  branchMerged: boolean;
  defaultBranch: string;
}

export type RemovalVerdict = { ok: true } | { ok: false; reason: string };

/** Removal never forces: a dirty tree is refused outright, and an unmerged
 *  branch is refused so its commits are never stranded. */
export function removalGuard(f: RemovalFacts): RemovalVerdict {
  if (f.dirty) {
    return {
      ok: false,
      reason: 'The worktree has uncommitted changes. Commit or discard them first; Argus never force-removes a worktree.',
    };
  }
  if (!f.prMerged && !f.branchMerged) {
    return {
      ok: false,
      reason: `The branch is not merged: its PR is not merged and it has commits that are not in ${f.defaultBranch}.`,
    };
  }
  return { ok: true };
}

// ── input + parsing ───────────────────────────────────────────────────────

export const COMMIT_MESSAGE_MAX = 10_000;

/** Error text for an unusable commit message, or null when it is fine. */
export function commitMessageError(message: unknown): string | null {
  if (typeof message !== 'string' || !message.trim()) return 'A commit message is required.';
  if (message.length > COMMIT_MESSAGE_MAX) return `The commit message is longer than ${COMMIT_MESSAGE_MAX} characters.`;
  if (message.includes('\0')) return 'The commit message contains a NUL character.';
  return null;
}

const GITHUB_REMOTE = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/(?:[^@/]+@)?github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;

/** GitHub "open a pull request" URL for `branch` against `base`; null for a
 *  remote that is not on github.com. */
export function compareUrl(remoteUrl: string, base: string, branch: string): string | null {
  const m = GITHUB_REMOTE.exec(remoteUrl.trim());
  if (!m) return null;
  const enc = (ref: string) => ref.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${m[1]}/${m[2]}/compare/${enc(base)}...${enc(branch)}?expand=1`;
}

/** The PR URL `gh pr create` prints as its last line; null when absent. */
export function parsePrCreateUrl(stdout: string): string | null {
  const urls = stdout.split('\n').map((l) => l.trim()).filter((l) => /^https:\/\/\S+\/pull\/\d+$/.test(l));
  return urls.length ? urls[urls.length - 1] : null;
}
