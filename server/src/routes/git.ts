import express, { Router } from 'express';
import type { SessionManager } from '../services/SessionManager.js';
import type { GitService } from '../services/GitService.js';
import type { ChangelistStore } from '../persistence/ChangelistStore.js';
import type { CommitSelectionStore } from '../persistence/CommitSelectionStore.js';
import type { PatchSelectionRequest, CommitRequest, GitCheckoutRequest, GitCreateBranchRequest, DiffFileRequest, GitPullAndBranchRequest, ChangelistStateResponse, CommitSelectionState } from '@argus/shared';
import { resolveRelativeWithinBase } from '../utils/pathScope.js';

function isSafeRef(ref: string): boolean {
  return !ref.startsWith('-') && !ref.includes('..');
}

export function createGitRoutes(manager: SessionManager, gitService: GitService, changelistStore: ChangelistStore, commitSelectionStore: CommitSelectionStore): Router {
  const router = Router();

  router.get('/sessions/:id/diff', async (req, res) => {
    const session = manager.getSessionInfo(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const diff = await gitService.getDiff(session.folderPath);

    if (diff.error === 'Not a git repository') {
      res.status(400).json(diff);
      return;
    }

    if (diff.error) {
      res.status(500).json(diff);
      return;
    }

    res.setHeader('Cache-Control', 'no-cache');
    res.json(diff);
  });

  router.get('/sessions/:id/diff-file', async (req, res) => {
    const session = manager.getSessionInfo(req.params.id);
    if (!session) {
      res.status(404).json({ diff: '', error: 'Session not found' });
      return;
    }

    const filePath = req.query.filePath as string | undefined;
    const contextLines = parseInt(req.query.contextLines as string, 10);
    const source = req.query.source as DiffFileRequest['source'] | undefined;

    if (!filePath || isNaN(contextLines) || !source) {
      res.status(400).json({ diff: '', error: 'filePath, contextLines, and source are required' });
      return;
    }

    if (!resolveRelativeWithinBase(session.folderPath, filePath)) {
      res.status(400).json({ diff: '', error: 'Invalid file path' });
      return;
    }

    if (!['unstaged', 'staged', 'branch'].includes(source)) {
      res.status(400).json({ diff: '', error: 'source must be unstaged, staged, or branch' });
      return;
    }

    const result = await gitService.getDiffForFile(session.folderPath, filePath, contextLines, source);

    if (result.error) {
      res.status(500).json(result);
      return;
    }

    res.setHeader('Cache-Control', 'no-cache');
    res.json(result);
  });

  router.get('/sessions/:id/diff-file-structured', async (req, res) => {
    const session = manager.getSessionInfo(req.params.id);
    if (!session) {
      res.status(404).json({ hunks: [], isBinary: false, error: 'Session not found' });
      return;
    }

    const filePath = req.query.filePath as string | undefined;
    const contextLines = parseInt(req.query.contextLines as string, 10);
    const source = req.query.source as DiffFileRequest['source'] | undefined;

    if (!filePath || isNaN(contextLines) || !source) {
      res.status(400).json({ hunks: [], isBinary: false, error: 'filePath, contextLines, and source are required' });
      return;
    }

    if (!resolveRelativeWithinBase(session.folderPath, filePath)) {
      res.status(400).json({ hunks: [], isBinary: false, error: 'Invalid file path' });
      return;
    }

    if (!['unstaged', 'staged', 'branch'].includes(source)) {
      res.status(400).json({ hunks: [], isBinary: false, error: 'source must be unstaged, staged, or branch' });
      return;
    }

    const result = await gitService.getDiffStructured(session.folderPath, filePath, contextLines, source);

    res.setHeader('Cache-Control', 'no-cache');
    res.json(result);
  });

  router.post('/sessions/:id/git-add', async (req, res) => {
    const session = manager.getSessionInfo(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const { filePath } = req.body as { filePath?: string };
    if (!filePath) {
      res.status(400).json({ error: 'filePath required' });
      return;
    }
    if (!resolveRelativeWithinBase(session.folderPath, filePath)) {
      res.status(400).json({ error: 'Invalid file path' });
      return;
    }

    const result = await gitService.stageFile(session.folderPath, filePath);
    if (!result.success) {
      res.status(500).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  });

  router.post('/sessions/:id/git-stage-patch', async (req, res) => {
    const session = manager.getSessionInfo(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const selection = req.body as PatchSelectionRequest;
    if (!selection?.filePath || !Array.isArray(selection?.chunks)) {
      res.status(400).json({ success: false, error: 'Invalid selection descriptor' });
      return;
    }
    if (!resolveRelativeWithinBase(session.folderPath, selection.filePath)) {
      res.status(400).json({ success: false, error: 'Invalid file path' });
      return;
    }
    if (selection.fromPath && !resolveRelativeWithinBase(session.folderPath, selection.fromPath)) {
      res.status(400).json({ success: false, error: 'Invalid fromPath' });
      return;
    }

    const result = await gitService.stagePatch(session.folderPath, selection);
    res.status(result.success ? 200 : 400).json(result);
  });

  router.post('/sessions/:id/git-discard-patch', async (req, res) => {
    const session = manager.getSessionInfo(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const selection = req.body as PatchSelectionRequest;
    if (!selection?.filePath || !Array.isArray(selection?.chunks)) {
      res.status(400).json({ success: false, error: 'Invalid selection descriptor' });
      return;
    }
    if (!resolveRelativeWithinBase(session.folderPath, selection.filePath)) {
      res.status(400).json({ success: false, error: 'Invalid file path' });
      return;
    }
    if (selection.fromPath && !resolveRelativeWithinBase(session.folderPath, selection.fromPath)) {
      res.status(400).json({ success: false, error: 'Invalid fromPath' });
      return;
    }

    const result = await gitService.discardPatch(session.folderPath, selection);
    res.status(result.success ? 200 : 400).json(result);
  });

  router.post('/sessions/:id/git-undo-discard/:undoId', async (req, res) => {
    const session = manager.getSessionInfo(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const result = await gitService.undoDiscard(req.params.undoId);
    res.status(result.success ? 200 : 404).json(result);
  });

  router.post('/sessions/:id/git-commit', async (req, res) => {
    const session = manager.getSessionInfo(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const { message, amend, files } = req.body as CommitRequest;
    if (!message?.trim()) {
      res.status(400).json({ success: false, error: 'Commit message required' });
      return;
    }

    const result = await gitService.commit(session.folderPath, message, !!amend, files);
    res.status(result.success ? 200 : 400).json(result);
  });

  router.post('/sessions/:id/git-unstage', async (req, res) => {
    const session = manager.getSessionInfo(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const { filePath } = req.body as { filePath?: string };
    if (!filePath) {
      res.status(400).json({ success: false, error: 'filePath required' });
      return;
    }
    if (!resolveRelativeWithinBase(session.folderPath, filePath)) {
      res.status(400).json({ success: false, error: 'Invalid file path' });
      return;
    }

    const result = await gitService.unstageFile(session.folderPath, filePath);
    res.status(result.success ? 200 : 400).json(result);
  });

  router.post('/sessions/:id/git-push', async (req, res) => {
    const session = manager.getSessionInfo(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const result = await gitService.push(session.folderPath);
    res.status(result.success ? 200 : 400).json(result);
  });

  router.post('/sessions/:id/git-pull', async (req, res) => {
    const session = manager.getSessionInfo(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const result = await gitService.pull(session.folderPath);
    res.status(result.success ? 200 : 400).json(result);
  });

  router.post('/sessions/:id/git-ignore', async (req, res) => {
    const session = manager.getSessionInfo(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const { filePath } = req.body as { filePath?: string };
    if (!filePath) {
      res.status(400).json({ success: false, error: 'filePath required' });
      return;
    }
    if (!resolveRelativeWithinBase(session.folderPath, filePath)) {
      res.status(400).json({ success: false, error: 'Invalid file path' });
      return;
    }

    const result = await gitService.addToGitignore(session.folderPath, filePath);
    res.status(result.success ? 200 : 500).json(result);
  });

  router.get('/sessions/:id/git-branches', async (req, res) => {
    const session = manager.getSessionInfo(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const result = await gitService.getBranches(session.folderPath);
    res.json(result);
  });

  router.post('/sessions/:id/git-checkout', async (req, res) => {
    const session = manager.getSessionInfo(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const { branch } = req.body as GitCheckoutRequest;
    if (!branch?.trim()) {
      res.status(400).json({ success: false, error: 'branch required' });
      return;
    }
    if (!isSafeRef(branch)) {
      res.status(400).json({ success: false, error: 'Invalid branch name' });
      return;
    }

    const result = await gitService.checkoutBranch(session.folderPath, branch);
    res.status(result.success ? 200 : 400).json(result);
  });

  router.post('/sessions/:id/git-create-branch', async (req, res) => {
    const session = manager.getSessionInfo(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const { name, from } = req.body as GitCreateBranchRequest;
    if (!name?.trim()) {
      res.status(400).json({ success: false, error: 'branch name required' });
      return;
    }
    if (!isSafeRef(name) || (from !== undefined && !isSafeRef(from))) {
      res.status(400).json({ success: false, error: 'Invalid branch name' });
      return;
    }

    const result = await gitService.createBranch(session.folderPath, name, from);
    res.status(result.success ? 200 : 400).json(result);
  });

  router.post('/sessions/:id/git-pull-and-branch', async (req, res) => {
    const session = manager.getSessionInfo(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const { branchName, baseBranch } = req.body as GitPullAndBranchRequest;
    if (!branchName?.trim()) {
      res.status(400).json({ success: false, error: 'Branch name required' });
      return;
    }

    const result = await gitService.pullAndBranch(session.folderPath, branchName, baseBranch);
    res.status(result.success ? 200 : 400).json(result);
  });

  router.get('/sessions/:id/git-file-statuses', async (req, res) => {
    const session = manager.getSessionInfo(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    try {
      const result = await gitService.getFileStatuses(session.folderPath);
      res.setHeader('Cache-Control', 'no-cache');
      res.json(result);
    } catch {
      res.status(500).json({ statuses: {}, gitRoot: '' });
    }
  });

  router.get('/sessions/:id/git-blame', async (req, res) => {
    const session = manager.getSessionInfo(req.params.id);
    if (!session) {
      res.status(404).json({ lines: [], error: 'Session not found' });
      return;
    }

    const filePath = req.query.filePath as string | undefined;
    if (!filePath) {
      res.status(400).json({ lines: [], error: 'filePath query parameter required' });
      return;
    }

    if (!resolveRelativeWithinBase(session.folderPath, filePath)) {
      res.status(400).json({ lines: [], error: 'Invalid file path' });
      return;
    }

    const result = await gitService.getBlame(session.folderPath, filePath);
    res.setHeader('Cache-Control', 'no-cache');
    res.json(result);
  });

  router.post('/sessions/:id/git-revert-file', async (req, res) => {
    const session = manager.getSessionInfo(req.params.id);
    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    const { filePath } = req.body as { filePath?: string };
    if (!filePath) {
      res.status(400).json({ success: false, error: 'filePath required' });
      return;
    }

    if (!resolveRelativeWithinBase(session.folderPath, filePath)) {
      res.status(400).json({ success: false, error: 'Invalid file path' });
      return;
    }

    const result = await gitService.revertFileToHead(session.folderPath, filePath);
    res.status(result.success ? 200 : 400).json(result);
  });

  router.get('/sessions/:id/git-log', async (req, res) => {
    const session = manager.getSessionInfo(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const result = await gitService.getLastCommit(session.folderPath);
    res.json(result);
  });

  router.get('/sessions/:id/changelists', async (req, res) => {
    const session = manager.getSessionInfo(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const state = await changelistStore.load(session.folderPath);
    res.setHeader('Cache-Control', 'no-cache');
    res.json(state);
  });

  router.put('/sessions/:id/changelists', express.json(), async (req, res) => {
    const session = manager.getSessionInfo(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const state = req.body as ChangelistStateResponse;
    if (!Array.isArray(state?.lists)) {
      res.status(400).json({ error: 'lists array is required' });
      return;
    }

    await changelistStore.save(session.folderPath, state);
    res.setHeader('Cache-Control', 'no-cache');
    res.json({ success: true });
  });

  router.get('/sessions/:id/commit-selection', async (req, res) => {
    const session = manager.getSessionInfo(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const state = await commitSelectionStore.load(session.folderPath);
    res.setHeader('Cache-Control', 'no-cache');
    res.json(state);
  });

  router.put('/sessions/:id/commit-selection', express.json(), async (req, res) => {
    const session = manager.getSessionInfo(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const state = req.body as CommitSelectionState;
    if (state?.version !== 1 || !Array.isArray(state?.files)) {
      res.status(400).json({ error: 'Invalid commit-selection state' });
      return;
    }
    await commitSelectionStore.save(session.folderPath, state);
    res.setHeader('Cache-Control', 'no-cache');
    res.json({ success: true });
  });

  router.get('/sessions/:id/git-worktree-parent-info', async (req, res) => {
    const session = manager.getSessionInfo(req.params.id);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
    if (!session.worktreePath || !session.worktreeBranch) {
      res.status(400).json({ error: 'Not a worktree session' });
      return;
    }
    try {
      const parentRepoPath = await gitService.getParentRepoPath(session.worktreePath);
      const defaultBranch = await gitService.getDefaultBranch(parentRepoPath);
      res.json({ parentRepoPath, defaultBranch });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/sessions/:id/git-merge-preview', async (req, res) => {
    const session = manager.getSessionInfo(req.params.id);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
    if (!session.worktreePath || !session.worktreeBranch) {
      res.status(400).json({ error: 'Not a worktree session' }); return;
    }
    const reqTarget = typeof req.query.targetBranch === 'string' ? req.query.targetBranch.trim() : '';
    if (reqTarget && /^-/.test(reqTarget)) { res.status(400).json({ error: 'Invalid branch name' }); return; }
    try {
      const parentRepoPath = await gitService.getParentRepoPath(session.worktreePath);
      const targetBranch = reqTarget || await gitService.getDefaultBranch(parentRepoPath);
      const result = await gitService.getWorktreeMergePreview(parentRepoPath, session.worktreeBranch, targetBranch);
      res.setHeader('Cache-Control', 'no-cache');
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/sessions/:id/git-merge-worktree', express.json(), async (req, res) => {
    const session = manager.getSessionInfo(req.params.id);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
    if (!session.worktreePath || !session.worktreeBranch) {
      res.status(400).json({ success: false, error: 'Not a worktree session' });
      return;
    }
    const { targetBranch: reqTargetBranch } = req.body as { targetBranch?: string };
    try {
      const parentRepoPath = await gitService.getParentRepoPath(session.worktreePath);
      const targetBranch = reqTargetBranch?.trim() || await gitService.getDefaultBranch(parentRepoPath);
      const result = await gitService.mergeWorktreeBranch(parentRepoPath, session.worktreeBranch, targetBranch);
      res.status(result.success ? 200 : 400).json({
        ...result,
        targetBranch,
        mergedBranch: session.worktreeBranch,
        parentRepoPath,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
