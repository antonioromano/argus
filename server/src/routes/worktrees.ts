import { Router } from 'express';
import path from 'path';
import os from 'os';
import type { Request, Response } from 'express';
import type { SessionInfo, WorktreeFinishInfo, WorktreeFinishResponse } from '@argus/shared';
import { resolveWithinBase } from '../utils/pathScope.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { SessionManager } from '../services/SessionManager.js';
import type { GitService } from '../services/GitService.js';
import type { PrStatusService } from '../services/PrStatusService.js';
import { isSafeRef } from './git.js';
import {
  commitMessageError,
  compareUrl,
  errorText,
  isFinishStep,
  removalGuard,
  runFinishSteps,
} from '../services/worktreeLifecycle.js';

const WORKTREES_BASE = path.join(os.homedir(), '.argus', 'worktrees');

/** Beta F8 wiring. Absent (or `isEnabled` false) → the lifecycle routes 404. */
export interface WorktreeLifecycleDeps {
  isEnabled: () => boolean;
  prService?: Pick<PrStatusService, 'forFolder' | 'ghAvailable' | 'createPr'> | null;
}

interface ResolvedWorktree {
  session: SessionInfo;
  worktreePath: string;
  branch: string;
  /** The main repository the worktree belongs to (where `git worktree` runs). */
  parentRepo: string;
}

export function createWorktreeRoutes(manager: SessionManager, gitService: GitService, lifecycle?: WorktreeLifecycleDeps): Router {
  const router = Router();

  /**
   * Beta F8 guard shared by the lifecycle routes: the flag is on, the id is a
   * worktree session, its worktree sits inside the managed base AND inside a
   * session Argus manages (pathScope), its branch is a safe ref, and that
   * branch is what is actually checked out there. Answers the error itself
   * and returns null when any of that fails.
   */
  async function resolveWorktree(req: Request, res: Response): Promise<ResolvedWorktree | null> {
    if (!lifecycle?.isEnabled()) {
      res.status(404).json({ error: 'Worktree lifecycle is a beta feature that is switched off.' });
      return null;
    }
    const session = manager.getSessionInfo(String(req.params.id));
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return null;
    }
    if (!session.worktreePath || !session.worktreeBranch) {
      res.status(400).json({ error: 'Not a worktree session' });
      return null;
    }
    const scoped = resolveWithinBase(WORKTREES_BASE, session.worktreePath);
    if (!scoped || scoped !== path.resolve(session.worktreePath) || !manager.resolveWithinAnySession(scoped)) {
      res.status(400).json({ error: 'Worktree is outside the managed worktrees directory' });
      return null;
    }
    const branch = session.worktreeBranch;
    if (!isSafeRef(branch)) {
      res.status(400).json({ error: 'Invalid branch name' });
      return null;
    }
    const head = await gitService.headInfo(scoped);
    if (!head) {
      res.status(409).json({ error: 'The worktree is not a git checkout any more' });
      return null;
    }
    if (head.branch !== branch) {
      res.status(409).json({ error: `The worktree has "${head.branch}" checked out, not "${branch}".` });
      return null;
    }
    const parentRepo = await gitService.getParentRepoPath(scoped);
    return { session, worktreePath: scoped, branch, parentRepo };
  }

  /** Whether the branch has no commits outside the default branch (local or origin's copy). */
  async function branchFullyMerged(parentRepo: string, branch: string, defaultBranch: string): Promise<boolean> {
    if (!isSafeRef(defaultBranch)) return false;
    if (!(await gitService.worktreeUnmergedCheck(parentRepo, branch, defaultBranch))) return true;
    return !(await gitService.worktreeUnmergedCheck(parentRepo, branch, `origin/${defaultBranch}`));
  }

  // GET /api/worktrees/sessions/:id/finish — what the Finish sheet shows.
  router.get('/sessions/:id/finish', asyncHandler(async (req, res) => {
    const wt = await resolveWorktree(req, res);
    if (!wt) return;
    const pr = lifecycle?.prService ?? null;
    const defaultBranch = await gitService.getDefaultBranch(wt.parentRepo);
    const [upstream, dirty, remote, prInfo, ghAvailable, branchMerged] = await Promise.all([
      gitService.upstreamOf(wt.worktreePath),
      gitService.worktreeDirtyCheck(wt.worktreePath),
      gitService.remoteUrl(wt.worktreePath),
      pr ? pr.forFolder(wt.worktreePath) : Promise.resolve(null),
      pr ? pr.ghAvailable(wt.worktreePath) : Promise.resolve(false),
      branchFullyMerged(wt.parentRepo, wt.branch, defaultBranch),
    ]);
    const verdict = removalGuard({ dirty, prMerged: prInfo?.state === 'merged', branchMerged, defaultBranch });
    const info: WorktreeFinishInfo = {
      worktreePath: wt.worktreePath,
      branch: wt.branch,
      upstream,
      defaultBranch,
      dirty,
      pr: prInfo,
      ghAvailable,
      compareUrl: remote ? compareUrl(remote, defaultBranch, wt.branch) : null,
      merged: prInfo?.state === 'merged' || branchMerged,
      removable: verdict.ok,
      ...(verdict.ok ? {} : { removeBlockedReason: verdict.reason }),
    };
    res.setHeader('Cache-Control', 'no-cache');
    res.json(info);
  }));

  // POST /api/worktrees/sessions/:id/finish — body { steps, message? }.
  // Runs commit → push → pr (whichever were asked for), stopping at the first failure.
  router.post('/sessions/:id/finish', asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { steps?: unknown; message?: unknown };
    if (!Array.isArray(body.steps) || body.steps.length === 0 || body.steps.length > 3 || !body.steps.every(isFinishStep)) {
      res.status(400).json({ error: 'steps must be a non-empty list of "commit", "push" and "pr"' });
      return;
    }
    const steps = body.steps;
    if (steps.includes('commit')) {
      const msgError = commitMessageError(body.message);
      if (msgError) { res.status(400).json({ error: msgError }); return; }
    }
    const wt = await resolveWorktree(req, res);
    if (!wt) return;
    const pr = lifecycle?.prService ?? null;

    const results = await runFinishSteps(steps, {
      commit: async () => {
        if (!(await gitService.worktreeDirtyCheck(wt.worktreePath))) return { ok: true, detail: 'Nothing to commit' };
        const r = await gitService.commitAll(wt.worktreePath, String(body.message));
        return r.success ? { ok: true, detail: r.commitHash } : { ok: false, detail: r.error };
      },
      push: async () => {
        const upstream = await gitService.upstreamOf(wt.worktreePath);
        const r = await gitService.pushBranch(wt.worktreePath, wt.branch, !upstream);
        return r.success ? { ok: true, detail: upstream ? `Pushed to ${upstream}` : `Published origin/${wt.branch}` } : { ok: false, detail: r.error };
      },
      pr: async () => {
        const defaultBranch = await gitService.getDefaultBranch(wt.parentRepo);
        if (!isSafeRef(defaultBranch)) return { ok: false, detail: `Invalid default branch "${defaultBranch}"` };
        const existing = pr ? await pr.forFolder(wt.worktreePath) : null;
        if (existing && (existing.state === 'open' || existing.state === 'draft')) {
          return { ok: true, detail: `PR #${existing.number} is already open`, url: existing.url };
        }
        if (pr && (await pr.ghAvailable(wt.worktreePath))) {
          try {
            return { ok: true, url: await pr.createPr(wt.parentRepo, wt.worktreePath, wt.branch, defaultBranch) };
          } catch (err) {
            return { ok: false, detail: errorText(err) };
          }
        }
        const remote = await gitService.remoteUrl(wt.worktreePath);
        const url = remote ? compareUrl(remote, defaultBranch, wt.branch) : null;
        return url
          ? { ok: true, detail: 'gh is not available; open the compare page to create the PR', url }
          : { ok: false, detail: 'gh is not available and origin is not a GitHub remote' };
      },
    });
    const response: WorktreeFinishResponse = { ok: results.every((r) => r.status === 'ok'), results };
    res.json(response);
  }));

  // POST /api/worktrees/sessions/:id/remove — end the session, then
  // `git worktree remove` (never --force). Only for a clean, merged branch.
  router.post('/sessions/:id/remove', asyncHandler(async (req, res) => {
    const wt = await resolveWorktree(req, res);
    if (!wt) return;
    const other = manager.getAllSessions().find(
      (s) => s.id !== wt.session.id && s.status !== 'exited' && path.resolve(s.folderPath) === wt.worktreePath,
    );
    if (other) {
      res.status(409).json({ error: `Session "${other.name}" is also using this worktree. Close it first.` });
      return;
    }
    const pr = lifecycle?.prService ?? null;
    const defaultBranch = await gitService.getDefaultBranch(wt.parentRepo);
    const [dirty, prInfo, branchMerged] = await Promise.all([
      gitService.worktreeDirtyCheck(wt.worktreePath),
      pr ? pr.forFolder(wt.worktreePath) : Promise.resolve(null),
      branchFullyMerged(wt.parentRepo, wt.branch, defaultBranch),
    ]);
    const verdict = removalGuard({ dirty, prMerged: prInfo?.state === 'merged', branchMerged, defaultBranch });
    if (!verdict.ok) {
      res.status(409).json({ error: verdict.reason });
      return;
    }
    await manager.destroySession(wt.session.id);
    try {
      await gitService.worktreeRemove(wt.parentRepo, wt.worktreePath, false);
    } catch (err) {
      res.status(500).json({ error: `The session ended, but git refused to remove the worktree: ${errorText(err)}` });
      return;
    }
    res.json({ success: true });
  }));

  // GET /api/worktrees/check
  // Query params:
  //   repoPath   (required) — path to check
  //   branch     (optional) — if set, also checks if this branch exists
  //   worktreePath (optional) — if set, also checks dirty/unmerged status for delete flow
  router.get('/check', async (req, res) => {
    const rawRepoPath = String(req.query.repoPath ?? '');
    if (!path.isAbsolute(rawRepoPath)) {
      res.status(400).json({ error: 'repoPath must be an absolute path' });
      return;
    }
    const repoPath = path.resolve(rawRepoPath);
    const branch = req.query.branch ? String(req.query.branch) : undefined;
    // Worktrees always live under the managed base — scope the dirty-check path to it
    // rather than running git status against an arbitrary directory.
    const rawWorktreePath = req.query.worktreePath ? String(req.query.worktreePath) : undefined;
    let worktreePath: string | undefined;
    if (rawWorktreePath) {
      const scoped = resolveWithinBase(WORKTREES_BASE, rawWorktreePath);
      if (!scoped) {
        res.status(400).json({ error: 'worktreePath must be within the managed worktrees directory' });
        return;
      }
      worktreePath = scoped;
    }

    const isGitRepo = await gitService.isGitRepo(repoPath);
    if (!isGitRepo) {
      res.json({ isGitRepo: false });
      return;
    }

    const result: Record<string, unknown> = { isGitRepo: true };

    if (branch) {
      if (/^-/.test(branch) || branch.includes('..')) {
        res.status(400).json({ error: 'Invalid branch name' });
        return;
      }
      try {
        const gitRoot = await gitService.getGitRoot(repoPath);
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const execFileAsync = promisify(execFile);
        const { stdout } = await execFileAsync('git', ['branch', '--list', '--', branch], { cwd: gitRoot });
        const branchExists = stdout.trim().length > 0;
        result.branchExists = branchExists;

        if (branchExists) {
          try {
            const { stdout: logOut } = await execFileAsync('git', ['log', '-1', '--format=%H %s', '--', branch], { cwd: gitRoot });
            result.headCommit = logOut.trim();
          } catch {
            result.headCommit = null;
          }
          // Check if the branch's worktree is dirty (only if the worktree dir exists)
          // We can't easily check this without knowing the worktree path, so omit
          result.hasUncommitted = false;
          result.hasUnpushed = false;
        }
      } catch {
        result.branchExists = false;
      }
    }

    if (worktreePath) {
      try {
        const gitRoot = await gitService.getGitRoot(repoPath);
        const worktreeBranch = req.query.worktreeBranch ? String(req.query.worktreeBranch) : undefined;
        result.isDirty = await gitService.worktreeDirtyCheck(worktreePath);
        if (worktreeBranch) {
          result.isUnmerged = await gitService.worktreeUnmergedCheck(gitRoot, worktreeBranch);
        }
      } catch {
        result.isDirty = false;
        result.isUnmerged = false;
      }
    }

    res.json(result);
  });

  // GET /api/worktrees/branches?repoPath=...
  // Lists branches for a repo path (used by the create-session base-branch picker).
  router.get('/branches', async (req, res) => {
    const rawRepoPath = String(req.query.repoPath ?? '');
    if (!path.isAbsolute(rawRepoPath)) {
      res.status(400).json({ error: 'repoPath must be an absolute path' });
      return;
    }
    const repoPath = path.resolve(rawRepoPath);
    const isGitRepo = await gitService.isGitRepo(repoPath);
    if (!isGitRepo) {
      res.json({ branches: [], currentBranch: '' });
      return;
    }
    try {
      const gitRoot = await gitService.getGitRoot(repoPath);
      const result = await gitService.getBranches(gitRoot);
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // DELETE /api/worktrees
  // Body: { worktreePath: string, repoPath: string, force?: boolean }
  router.delete('/', async (req, res) => {
    const { worktreePath, repoPath, force = false } = req.body as {
      worktreePath: string;
      repoPath: string;
      force?: boolean;
    };

    if (!worktreePath || !repoPath) {
      res.status(400).json({ error: 'worktreePath and repoPath are required' });
      return;
    }

    // Security: only allow deletion within the managed worktrees directory
    const resolvedWorktreePath = path.resolve(worktreePath);
    if (!resolvedWorktreePath.startsWith(WORKTREES_BASE + path.sep)) {
      res.status(400).json({ error: 'worktreePath must be within the managed worktrees directory' });
      return;
    }

    // Block deletion if a live (non-exited) session is using this worktree
    const allSessions = manager.getAllSessions();
    const liveSession = allSessions.find(
      (s) => s.folderPath === resolvedWorktreePath && s.status !== 'exited',
    );
    if (liveSession) {
      res.status(409).json({
        error: `Session "${liveSession.name}" is still using this worktree. Close it before deleting.`,
      });
      return;
    }

    try {
      const resolvedRepoPath = path.resolve(repoPath);
      const gitRoot = await gitService.getGitRoot(resolvedRepoPath);
      await gitService.worktreeRemove(gitRoot, resolvedWorktreePath, force);
      res.status(204).send();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const stderr = (err as { stderr?: string }).stderr ?? '';
      res.status(400).json({ error: stderr || msg });
    }
  });

  // POST /api/worktrees/init
  // Body: { folderPath: string }
  router.post('/init', async (req, res) => {
    const { folderPath } = req.body as { folderPath?: string };
    if (!folderPath) {
      res.status(400).json({ error: 'folderPath is required' });
      return;
    }
    const resolved = path.resolve(folderPath);
    const home = os.homedir();
    if (!resolved.startsWith(home + path.sep) && resolved !== home) {
      res.status(400).json({ error: 'folderPath must be within the home directory' });
      return;
    }
    try {
      await gitService.init(resolved);
      res.status(200).json({ success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
