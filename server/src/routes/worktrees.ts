import { Router } from 'express';
import path from 'path';
import os from 'os';
import type { SessionManager } from '../services/SessionManager.js';
import type { GitService } from '../services/GitService.js';

const WORKTREES_BASE = path.join(os.homedir(), '.argus', 'worktrees');

export function createWorktreeRoutes(manager: SessionManager, gitService: GitService): Router {
  const router = Router();

  // GET /api/worktrees/check
  // Query params:
  //   repoPath   (required) — path to check
  //   branch     (optional) — if set, also checks if this branch exists
  //   worktreePath (optional) — if set, also checks dirty/unmerged status for delete flow
  router.get('/check', async (req, res) => {
    const repoPath = path.resolve(String(req.query.repoPath ?? ''));
    const branch = req.query.branch ? String(req.query.branch) : undefined;
    const worktreePath = req.query.worktreePath ? String(req.query.worktreePath) : undefined;

    if (!repoPath) {
      res.status(400).json({ error: 'repoPath is required' });
      return;
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
