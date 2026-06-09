import { execFile } from 'child_process';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { appendFile } from 'fs/promises';
import path from 'path';
import type { GitDiffResponse, GitFileStatusCode, GitFileStatusResponse, PatchSelectionRequest, PatchOperationResponse, CommitResponse, GitLogResponse, GitBranchesResponse, DiffFileResponse, StructuredDiffResponse, StructuredHunk, SideBySideLine, DiffToken, BlameResponse, BlameLineEntry, WorktreeMergePreviewResponse, MergePreviewFile } from '@argus/shared';

function findGit(): string {
  try {
    return execSync('which git', { encoding: 'utf-8' }).trim();
  } catch {
    return 'git';
  }
}

const GIT_PATH = findGit();
const TIMEOUT_MS = 10_000;
const UNDO_TTL_MS = 30_000;

interface UndoEntry {
  patchText: string;
  folderPath: string;
  timer: ReturnType<typeof setTimeout>;
}

function execGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(GIT_PATH, args, { cwd, timeout: TIMEOUT_MS, maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(stdout);
    });
  });
}

// Like execGit but captures stderr for surfacing git hook/apply errors
function execGitWithStderr(args: string[], cwd: string, stdinData?: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(GIT_PATH, args, { cwd, timeout: TIMEOUT_MS, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject({ message: err.message, stderr });
        return;
      }
      resolve({ stdout, stderr });
    });
    if (stdinData !== undefined && child.stdin) {
      child.stdin.write(stdinData);
      child.stdin.end();
    }
  });
}

interface ParsedHunk {
  header: string;
  oldStart: number;
  changes: string[]; // raw lines (may include +, -, space, \)
}

function parseHunks(diffText: string): ParsedHunk[] {
  const lines = diffText.split('\n');
  const hunks: ParsedHunk[] = [];
  let i = 0;

  // Skip file header lines (diff --git, index, ---, +++)
  while (i < lines.length && !lines[i].startsWith('@@')) {
    i++;
  }

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
      const oldStart = match ? parseInt(match[1]) : 0;
      const changes: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('@@')) {
        if (lines[i] !== '') changes.push(lines[i]);
        i++;
      }
      hunks.push({ header: line, oldStart, changes });
    } else {
      i++;
    }
  }
  return hunks;
}

function buildPatchText(fileHeader: string, hunks: ParsedHunk[], selection: PatchSelectionRequest, mode: 'stage' | 'discard'): string {
  const patchLines: string[] = [fileHeader];
  let cumulativeDelta = 0;

  for (const chunkSel of selection.chunks) {
    const hunk = hunks[chunkSel.chunkIndex];
    if (!hunk) continue;

    const selectedSet = new Set(chunkSel.selectedChangeIndices);
    const processedLines: string[] = [];
    let normalCount = 0;
    let selectedAddCount = 0;
    let selectedDelCount = 0;
    let changeIndex = 0;
    let lastLineDropped = false;

    for (const rawLine of hunk.changes) {
      if (rawLine === '\\ No newline at end of file') {
        if (!lastLineDropped) processedLines.push(rawLine);
        lastLineDropped = false;
        continue;
      }
      lastLineDropped = false;
      const prefix = rawLine[0];
      if (prefix === '+') {
        if (selectedSet.has(changeIndex)) {
          processedLines.push(rawLine);
          selectedAddCount++;
        } else if (mode === 'stage') {
          // stage: unselected adds don't exist in the index, drop them
          lastLineDropped = true;
        } else {
          // discard: unselected adds exist in the working tree, keep as context
          processedLines.push(' ' + rawLine.slice(1));
          normalCount++;
        }
        changeIndex++;
      } else if (prefix === '-') {
        if (selectedSet.has(changeIndex)) {
          processedLines.push(rawLine);
          selectedDelCount++;
        } else if (mode === 'discard') {
          // discard: unselected dels don't exist in the working tree, drop them
          lastLineDropped = true;
        } else {
          // stage: unselected dels exist in the index, keep as context
          processedLines.push(' ' + rawLine.slice(1));
          normalCount++;
        }
        changeIndex++;
      } else {
        // Context line (space prefix or other)
        processedLines.push(rawLine);
        if (prefix === ' ') normalCount++;
      }
    }

    if (selectedAddCount === 0 && selectedDelCount === 0) continue; // nothing to patch in this hunk

    const oldCount = normalCount + selectedDelCount;
    const newCount = normalCount + selectedAddCount;
    const newStart = hunk.oldStart + cumulativeDelta;

    const match = hunk.header.match(/@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@(.*)/);
    const tail = match ? match[1] : '';
    const oldCountStr = oldCount === 1 ? '' : `,${oldCount}`;
    const newCountStr = newCount === 1 ? '' : `,${newCount}`;
    const hunkHeader = `@@ -${hunk.oldStart}${oldCountStr} +${newStart}${newCountStr} @@${tail}`;

    patchLines.push(hunkHeader);
    patchLines.push(...processedLines);

    cumulativeDelta += selectedAddCount - selectedDelCount;
  }

  // Ensure patch ends with newline
  const result = patchLines.join('\n');
  return result.endsWith('\n') ? result : result + '\n';
}

function extractFileHeader(diffText: string): string {
  const lines = diffText.split('\n');
  const headerLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('@@')) break;
    headerLines.push(line);
  }
  return headerLines.join('\n');
}

/**
 * Parse the output of `git diff --word-diff=porcelain` into a structured
 * side-by-side representation.
 *
 * Porcelain word-diff format:
 *   - File header lines (diff --git, index, ---, +++) precede hunk blocks
 *   - Each hunk starts with `@@ -oldStart,oldLen +newStart,newLen @@ ...`
 *   - Logical lines within a hunk are delimited by `\n~` (a line containing
 *     only `~` marks the end of each logical line)
 *   - Inside a logical line: `[-deleted text-]` and `{+inserted text+}` mark
 *     word-level changes; everything else is context
 */
export function parseWordDiff(rawOutput: string): StructuredDiffResponse {
  if (rawOutput.includes('Binary files')) {
    return { hunks: [], isBinary: true };
  }

  const hunks: StructuredHunk[] = [];
  const lines = rawOutput.split('\n');
  let i = 0;

  // Skip file header lines until first @@
  while (i < lines.length && !lines[i].startsWith('@@')) {
    i++;
  }

  // Regex to parse hunk header: @@ -oldStart[,oldLen] +newStart[,newLen] @@ [context]
  const hunkHeaderRe = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/;

  // Regex to tokenize a logical line's content.
  // Group 1: deleted word  [-...-]
  // Group 2: inserted word {+...+}
  // Group 3: context text (anything that is not a newline, matched last)
  const tokenRe = /\[-(.*?)-\]|\{\+(.+?)\+\}|([^\n]+)/gs;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.startsWith('@@')) {
      i++;
      continue;
    }

    // Parse hunk header
    const headerMatch = line.match(hunkHeaderRe);
    const oldStart = headerMatch ? parseInt(headerMatch[1], 10) : 0;
    const newStart = headerMatch ? parseInt(headerMatch[2], 10) : 0;
    const hunkHeader = line;
    i++;

    // Collect all raw lines belonging to this hunk (up to next @@ or end)
    const hunkRawLines: string[] = [];
    while (i < lines.length && !lines[i].startsWith('@@')) {
      hunkRawLines.push(lines[i]);
      i++;
    }

    // The porcelain word-diff format uses `~` as a line terminator.
    // Rejoin hunk lines and split by \n~ to get per-logical-line segments.
    const hunkContent = hunkRawLines.join('\n');
    const segments = hunkContent.split('\n~').filter(seg => seg.length > 0);

    let old_ln = oldStart;
    let new_ln = newStart;

    const sideBySideLines: SideBySideLine[] = [];

    for (const segment of segments) {
      // Tokenize the segment content into context/del/add tokens
      const tokens: DiffToken[] = [];
      tokenRe.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = tokenRe.exec(segment)) !== null) {
        if (match[1] !== undefined) {
          tokens.push({ type: 'del', text: match[1] });
        } else if (match[2] !== undefined) {
          tokens.push({ type: 'add', text: match[2] });
        } else if (match[3] !== undefined) {
          tokens.push({ type: 'context', text: match[3] });
        }
      }

      const hasDel = tokens.some(t => t.type === 'del');
      const hasAdd = tokens.some(t => t.type === 'add');

      if (hasDel && !hasAdd) {
        // Deleted line: left shows deletion, right is a spacer
        sideBySideLines.push({
          left: {
            type: 'del',
            lineNo: old_ln++,
            tokens: tokens.filter(t => t.type !== 'add'),
          },
          right: {
            type: 'spacer',
            lineNo: null,
            tokens: [],
          },
        });
      } else if (hasAdd && !hasDel) {
        // Added line: left is a spacer, right shows addition
        sideBySideLines.push({
          left: {
            type: 'spacer',
            lineNo: null,
            tokens: [],
          },
          right: {
            type: 'add',
            lineNo: new_ln++,
            tokens: tokens.filter(t => t.type !== 'del'),
          },
        });
      } else if (hasDel && hasAdd) {
        // Mixed line: both sides show inline word-level changes
        sideBySideLines.push({
          left: {
            type: 'del',
            lineNo: old_ln++,
            tokens: tokens.filter(t => t.type !== 'add'),
          },
          right: {
            type: 'add',
            lineNo: new_ln++,
            tokens: tokens.filter(t => t.type !== 'del'),
          },
        });
      } else {
        // Context line: both sides are identical
        sideBySideLines.push({
          left: {
            type: 'context',
            lineNo: old_ln++,
            tokens,
          },
          right: {
            type: 'context',
            lineNo: new_ln++,
            tokens,
          },
        });
      }
    }

    hunks.push({
      header: hunkHeader,
      oldStart,
      newStart,
      lines: sideBySideLines,
    });
  }

  return { hunks, isBinary: false };
}

export class GitService {
  private undoBuffer = new Map<string, UndoEntry>();
  private blameCache = new Map<string, { data: BlameResponse; headSha: string }>();

  async isGitRepo(folderPath: string): Promise<boolean> {
    try {
      await execGit(['rev-parse', '--is-inside-work-tree'], folderPath);
      return true;
    } catch {
      return false;
    }
  }

  async getGitRoot(folderPath: string): Promise<string> {
    return (await execGit(['rev-parse', '--show-toplevel'], folderPath)).trim();
  }

  async worktreeAdd(gitRoot: string, destPath: string, branchName: string, baseBranch: string): Promise<void> {
    if (/^-/.test(branchName) || /^-/.test(baseBranch)) {
      throw new Error('Invalid branch or base name');
    }
    await execGitWithStderr(['worktree', 'add', destPath, '-b', branchName, '--', baseBranch], gitRoot);
  }

  async worktreeRemove(gitRoot: string, destPath: string, force = false): Promise<void> {
    const args = ['worktree', 'remove', destPath];
    if (force) args.push('--force');
    await execGitWithStderr(args, gitRoot);
  }

  async worktreeDirtyCheck(worktreePath: string): Promise<boolean> {
    try {
      const output = await execGit(['status', '--porcelain'], worktreePath);
      return output.trim().length > 0;
    } catch {
      return false;
    }
  }

  async getParentRepoPath(worktreePath: string): Promise<string> {
    const commonDir = (await execGit(['rev-parse', '--git-common-dir'], worktreePath)).trim();
    const absCommonDir = path.isAbsolute(commonDir)
      ? commonDir
      : path.resolve(worktreePath, commonDir);
    return absCommonDir.endsWith('/.git') ? absCommonDir.slice(0, -5) : absCommonDir;
  }

  async mergeWorktreeBranch(parentRepoPath: string, sourceBranch: string, targetBranch: string): Promise<{ success: boolean; error?: string }> {
    if (/^-/.test(sourceBranch) || /^-/.test(targetBranch)) {
      return { success: false, error: 'Invalid branch name' };
    }
    // Capture current branch so we can restore it if checkout succeeds but merge fails
    let originalBranch: string | null = null;
    try {
      const ref = (await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], parentRepoPath)).trim();
      if (ref !== 'HEAD') originalBranch = ref; // 'HEAD' = detached, skip restore
    } catch { /* proceed without restore capability */ }

    let checkedOut = false;
    try {
      await execGitWithStderr(['checkout', targetBranch], parentRepoPath);
      checkedOut = true;
      await execGitWithStderr(['merge', '--no-ff', sourceBranch], parentRepoPath);
      return { success: true };
    } catch (err) {
      const e = err as { message?: string; stderr?: string };
      try { await execGitWithStderr(['merge', '--abort'], parentRepoPath); } catch { /* no merge in progress */ }
      // Restore original branch if checkout moved HEAD but merge failed
      if (checkedOut && originalBranch) {
        try { await execGitWithStderr(['checkout', originalBranch], parentRepoPath); } catch { /* ignore */ }
      }
      return { success: false, error: e.stderr || e.message || 'Merge failed' };
    }
  }

  async getWorktreeMergePreview(
    parentRepoPath: string,
    sourceBranch: string,
    targetBranch: string,
  ): Promise<WorktreeMergePreviewResponse> {
    if (/^-/.test(sourceBranch) || /^-/.test(targetBranch)) {
      throw new Error('Invalid branch name');
    }
    const range = `${targetBranch}...${sourceBranch}`;

    // Get per-file stats: "<adds>\t<dels>\t<path>" per line
    const numstat = await execGit(['diff', '--numstat', range], parentRepoPath);
    const statLines = numstat.trim().split('\n').filter(Boolean);

    const statsMap = new Map<string, { additions: number; deletions: number }>();
    for (const line of statLines) {
      const [adds, dels, ...pathParts] = line.split('\t');
      const filePath = pathParts.join('\t');
      if (!filePath) continue;
      statsMap.set(filePath, {
        additions: parseInt(adds, 10) || 0,
        deletions: parseInt(dels, 10) || 0,
      });
    }

    // Detect new/deleted files
    const nameStatus = await execGit(['diff', '--name-status', range], parentRepoPath);
    const statusMap = new Map<string, { isNew: boolean; isDeleted: boolean }>();
    for (const line of nameStatus.trim().split('\n').filter(Boolean)) {
      const [status, ...rest] = line.split('\t');
      const filePath = rest[rest.length - 1];
      if (!filePath) continue;
      statusMap.set(filePath, {
        isNew: status.startsWith('A'),
        isDeleted: status.startsWith('D'),
      });
    }

    // Fetch per-file diffs in parallel (capped to avoid spawning too many processes)
    const filePaths = [...statsMap.keys()];
    const PREVIEW_TIMEOUT_MS = 30_000;

    const fetchDiff = (filePath: string): Promise<string> =>
      new Promise((resolve) => {
        execFile(GIT_PATH, ['diff', range, '--', filePath], { cwd: parentRepoPath, timeout: PREVIEW_TIMEOUT_MS, maxBuffer: 5 * 1024 * 1024 }, (_err, stdout) => {
          resolve(stdout || '');
        });
      });

    const BATCH = 8;
    const diffs: string[] = [];
    for (let i = 0; i < filePaths.length; i += BATCH) {
      const batch = filePaths.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(fetchDiff));
      diffs.push(...results);
    }

    const files: MergePreviewFile[] = filePaths.map((filePath, idx) => {
      const stats = statsMap.get(filePath) ?? { additions: 0, deletions: 0 };
      const st = statusMap.get(filePath) ?? { isNew: false, isDeleted: false };
      return {
        path: filePath,
        additions: stats.additions,
        deletions: stats.deletions,
        diff: diffs[idx] ?? '',
        isNew: st.isNew,
        isDeleted: st.isDeleted,
      };
    });

    const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
    const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);

    return { files, totalAdditions, totalDeletions, sourceBranch, targetBranch };
  }

  async init(folderPath: string): Promise<void> {
    await execGitWithStderr(['init'], folderPath);
  }

  // Returns true when branchName has commits not yet in targetBranch (i.e. unmerged).
  async worktreeUnmergedCheck(gitRoot: string, branchName: string, targetBranch = 'HEAD'): Promise<boolean> {
    if (/^-/.test(branchName) || /^-/.test(targetBranch)) {
      return false; // treat invalid refs as merged to avoid blocking deletion
    }
    try {
      await execGit(['merge-base', '--is-ancestor', '--', branchName, targetBranch], gitRoot);
      return false; // is ancestor → fully merged
    } catch {
      return true; // not ancestor → unmerged commits exist
    }
  }

  private async getBranchDiff(folderPath: string): Promise<string> {
    try {
      return await execGit(['diff', 'HEAD'], folderPath);
    } catch {
      return '';
    }
  }

  private async getUntrackedFiles(folderPath: string): Promise<string[]> {
    try {
      const output = await execGit(['ls-files', '--others', '--exclude-standard'], folderPath);
      return output.split('\n').map(l => l.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  async getDiff(folderPath: string): Promise<GitDiffResponse> {
    const isRepo = await this.isGitRepo(folderPath);
    if (!isRepo) {
      return { unstaged: '', staged: '', branch: '', untracked: [], error: 'Not a git repository' };
    }

    try {
      const [unstaged, staged, branch, untracked] = await Promise.all([
        execGit(['diff'], folderPath),
        execGit(['diff', '--cached'], folderPath),
        this.getBranchDiff(folderPath),
        this.getUntrackedFiles(folderPath),
      ]);
      return { unstaged, staged, branch, untracked };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get diff';
      return { unstaged: '', staged: '', branch: '', untracked: [], error: message };
    }
  }

  async getDiffForFile(folderPath: string, filePath: string, contextLines: number, source: 'unstaged' | 'staged' | 'branch'): Promise<DiffFileResponse> {
    const isRepo = await this.isGitRepo(folderPath);
    if (!isRepo) {
      return { diff: '', error: 'Not a git repository' };
    }

    // Cap context to prevent abuse
    const ctx = Math.min(Math.max(contextLines, 0), 200);

    try {
      const args = ['diff', `-U${ctx}`];
      if (source === 'staged') {
        args.push('--cached');
      } else if (source === 'branch') {
        args.push('HEAD');
      }
      args.push('--', filePath);

      const diff = await execGit(args, folderPath);
      return { diff };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get file diff';
      return { diff: '', error: message };
    }
  }


  async getDiffStructured(
    folderPath: string,
    filePath: string,
    contextLines: number,
    source: 'unstaged' | 'staged' | 'branch',
  ): Promise<StructuredDiffResponse> {
    // Cap context to [0, 200] to prevent abuse
    const ctx = Math.min(Math.max(contextLines, 0), 200);

    try {
      const args = ['diff', '--word-diff=porcelain', `-U${ctx}`];
      if (source === 'staged') {
        args.push('--cached');
      } else if (source === 'branch') {
        args.push('HEAD');
      }
      args.push('--', filePath);

      const output = await execGit(args, folderPath);

      if (output.includes('Binary files')) {
        return { hunks: [], isBinary: true };
      }

      if (!output.trim()) {
        return { hunks: [], isBinary: false };
      }

      return parseWordDiff(output);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get structured diff';
      return { hunks: [], isBinary: false, error: message };
    }
  }

  async stagePatch(folderPath: string, selection: PatchSelectionRequest): Promise<PatchOperationResponse> {
    try {
      const diffArgs = selection.source === 'staged'
        ? ['diff', '--cached', '--', selection.filePath]
        : ['diff', '--', selection.filePath];
      const diffText = await execGit(diffArgs, folderPath);
      if (!diffText.trim()) {
        return { success: false, error: 'No diff found for this file' };
      }

      const hunks = parseHunks(diffText);
      const fileHeader = extractFileHeader(diffText);
      const patchText = buildPatchText(fileHeader, hunks, selection, 'stage');

      await execGitWithStderr(['apply', '--cached', '--whitespace=nowarn', '-'], folderPath, patchText);
      return { success: true };
    } catch (err) {
      const e = err as { message?: string; stderr?: string };
      return { success: false, error: e.stderr || e.message || 'Failed to stage patch' };
    }
  }

  async discardPatch(folderPath: string, selection: PatchSelectionRequest): Promise<PatchOperationResponse> {
    try {
      const diffText = await execGit(['diff', '--', selection.filePath], folderPath);
      if (!diffText.trim()) {
        return { success: false, error: 'No diff found for this file' };
      }

      const hunks = parseHunks(diffText);
      const fileHeader = extractFileHeader(diffText);
      const patchText = buildPatchText(fileHeader, hunks, selection, 'discard');

      await execGitWithStderr(['apply', '-R', '--whitespace=nowarn', '-'], folderPath, patchText);

      const undoId = randomUUID();
      const timer = setTimeout(() => {
        this.undoBuffer.delete(undoId);
      }, UNDO_TTL_MS);

      this.undoBuffer.set(undoId, { patchText, folderPath, timer });
      return { success: true, undoId };
    } catch (err) {
      const e = err as { message?: string; stderr?: string };
      return { success: false, error: e.stderr || e.message || 'Failed to discard patch' };
    }
  }

  async undoDiscard(undoId: string): Promise<PatchOperationResponse> {
    const entry = this.undoBuffer.get(undoId);
    if (!entry) {
      return { success: false, error: 'Undo window expired or not found' };
    }

    try {
      await execGitWithStderr(['apply', '--whitespace=nowarn', '-'], entry.folderPath, entry.patchText);
      clearTimeout(entry.timer);
      this.undoBuffer.delete(undoId);
      return { success: true };
    } catch (err) {
      const e = err as { message?: string; stderr?: string };
      return { success: false, error: e.stderr || e.message || 'Failed to undo discard' };
    }
  }

  async stageFile(folderPath: string, filePath: string): Promise<PatchOperationResponse> {
    try {
      await execGitWithStderr(['add', '--', filePath], folderPath);
      return { success: true };
    } catch (err) {
      const e = err as { message?: string; stderr?: string };
      return { success: false, error: e.stderr || e.message || 'Failed to stage file' };
    }
  }

  async unstageFile(folderPath: string, filePath: string): Promise<PatchOperationResponse> {
    try {
      await execGitWithStderr(['restore', '--staged', '--', filePath], folderPath);
      return { success: true };
    } catch (err) {
      const e = err as { message?: string; stderr?: string };
      return { success: false, error: e.stderr || e.message || 'Failed to unstage file' };
    }
  }

  async commit(folderPath: string, message: string, amend: boolean, files?: string[]): Promise<CommitResponse> {
    try {
      const args = ['commit', '-m', message];
      if (amend) args.push('--amend');
      if (files && files.length > 0) {
        args.push('--', ...files);
      }
      const { stdout } = await execGitWithStderr(args, folderPath);
      // Extract short hash from output like "[branch abc1234] message"
      const hashMatch = stdout.match(/\[.*? ([a-f0-9]+)\]/);
      // Clear blame cache since HEAD has changed
      this.blameCache.clear();
      return { success: true, commitHash: hashMatch?.[1] };
    } catch (err) {
      const e = err as { message?: string; stderr?: string };
      // Combine stdout/stderr for pre-commit hook failures
      const errorText = e.stderr || e.message || 'Commit failed';
      return { success: false, error: errorText };
    }
  }

  async push(folderPath: string): Promise<PatchOperationResponse> {
    try {
      await execGitWithStderr(['push'], folderPath);
      return { success: true };
    } catch (err) {
      const e = err as { message?: string; stderr?: string };
      return { success: false, error: e.stderr || e.message || 'Push failed' };
    }
  }

  async getLastCommit(folderPath: string): Promise<GitLogResponse> {
    try {
      const output = await execGit(['log', '-1', '--pretty=%B'], folderPath);
      return { lastMessage: output.trimEnd(), isFirstCommit: false };
    } catch {
      return { lastMessage: '', isFirstCommit: true };
    }
  }

  async hasChanges(folderPath: string): Promise<boolean> {
    try {
      const output = await execGit(['status', '--porcelain'], folderPath);
      return output.trim().length > 0;
    } catch {
      return false;
    }
  }

  async getBranches(folderPath: string): Promise<GitBranchesResponse> {
    try {
      const output = await execGit(['branch'], folderPath);
      const lines = output.split('\n').map(l => l.trim()).filter(Boolean);
      let currentBranch = '';
      const branches: string[] = [];
      for (const line of lines) {
        if (line.startsWith('* ')) {
          const name = line.slice(2).trim();
          currentBranch = name;
          // Don't include detached HEAD as a selectable branch
          if (!name.startsWith('(')) {
            branches.push(name);
          }
        } else {
          branches.push(line);
        }
      }

      let behindCount: number | undefined;
      try {
        const countStr = await execGit(['rev-list', 'HEAD..@{u}', '--count'], folderPath);
        const n = parseInt(countStr.trim(), 10);
        if (!isNaN(n)) behindCount = n;
      } catch {
        // no upstream tracking branch — leave undefined
      }

      return { branches: branches.sort(), currentBranch, behindCount };
    } catch {
      return { branches: [], currentBranch: '' };
    }
  }

  async pull(folderPath: string): Promise<PatchOperationResponse> {
    try {
      await execGitWithStderr(['pull'], folderPath);
      return { success: true };
    } catch (err) {
      const e = err as { message?: string; stderr?: string };
      return { success: false, error: e.stderr || e.message || 'Pull failed' };
    }
  }

  async checkoutBranch(folderPath: string, branch: string): Promise<PatchOperationResponse> {
    try {
      await execGitWithStderr(['checkout', branch], folderPath);
      return { success: true };
    } catch (err) {
      const e = err as { message?: string; stderr?: string };
      return { success: false, error: e.stderr || e.message || 'Checkout failed' };
    }
  }

  async createBranch(folderPath: string, name: string, from?: string): Promise<PatchOperationResponse> {
    try {
      const args = from ? ['checkout', '-b', name, from] : ['checkout', '-b', name];
      await execGitWithStderr(args, folderPath);
      return { success: true };
    } catch (err) {
      const e = err as { message?: string; stderr?: string };
      return { success: false, error: e.stderr || e.message || 'Create branch failed' };
    }
  }

  async getDefaultBranch(folderPath: string): Promise<string> {
    try {
      const output = await execGit(['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'], folderPath);
      const branch = output.trim().replace('origin/', '');
      if (branch) return branch;
    } catch { /* ignore */ }

    const { branches } = await this.getBranches(folderPath);
    if (branches.includes('main')) return 'main';
    if (branches.includes('master')) return 'master';
    return 'main';
  }

  async pullAndBranch(
    folderPath: string,
    branchName: string,
    baseBranch?: string,
  ): Promise<{ success: boolean; error?: string; baseBranch?: string; newBranch?: string }> {
    try {
      if (!branchName.trim() || /\s/.test(branchName)) {
        return { success: false, error: 'Branch name cannot contain spaces' };
      }
      try {
        await execGit(['check-ref-format', '--branch', branchName], folderPath);
      } catch {
        return { success: false, error: `Invalid branch name: "${branchName}"` };
      }

      const resolvedBase = baseBranch || await this.getDefaultBranch(folderPath);

      if (await this.hasChanges(folderPath)) {
        return { success: false, error: 'You have uncommitted changes. Please commit or stash them first.' };
      }

      await execGitWithStderr(['fetch', 'origin'], folderPath);

      const checkout = await this.checkoutBranch(folderPath, resolvedBase);
      if (!checkout.success) {
        return { success: false, error: `Failed to checkout ${resolvedBase}: ${checkout.error}` };
      }

      const pullResult = await this.pull(folderPath);
      if (!pullResult.success) {
        return { success: false, error: `Failed to pull ${resolvedBase}: ${pullResult.error}` };
      }

      const create = await this.createBranch(folderPath, branchName);
      if (!create.success) {
        return { success: false, error: `Failed to create branch: ${create.error}` };
      }

      return { success: true, baseBranch: resolvedBase, newBranch: branchName };
    } catch (err) {
      const e = err as { message?: string; stderr?: string };
      return { success: false, error: e.stderr || e.message || 'Pull and branch failed' };
    }
  }

  async getFileStatuses(folderPath: string): Promise<GitFileStatusResponse> {
    const isRepo = await this.isGitRepo(folderPath);
    if (!isRepo) {
      return { statuses: {}, gitRoot: '' };
    }

    try {
      const [statusOutput, toplevel] = await Promise.all([
        execGit(['status', '--porcelain', '--ignored'], folderPath),
        execGit(['rev-parse', '--show-toplevel'], folderPath),
      ]);

      const gitRoot = toplevel.trim();
      const statuses: Record<string, GitFileStatusCode> = {};

      // Porcelain format: "XY PATH" where X=index status, Y=worktree status
      for (const line of statusOutput.split('\n')) {
        if (line.length < 4) continue;

        const xy = line.substring(0, 2);
        const filePart = line.substring(3);

        // Ignored files: "!! path"
        if (xy === '!!') {
          statuses[filePart] = '!!';
          continue;
        }

        // Untracked files: "?? path"
        if (xy === '??') {
          statuses[filePart] = '?';
          continue;
        }

        // Renames/copies: "R  old -> new" or "C  old -> new"
        const x = xy[0];
        const y = xy[1];

        let resolvedPath = filePart;
        if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
          const arrowIdx = filePart.indexOf(' -> ');
          if (arrowIdx !== -1) {
            resolvedPath = filePart.substring(arrowIdx + 4);
          }
          statuses[resolvedPath] = x === 'R' || y === 'R' ? 'R' : 'C';
          continue;
        }

        // Collapse the two-char XY into one code. We don't distinguish staged
        // vs unstaged, so prefer the more severe: D wins over everything.
        if (x === 'D' || y === 'D') {
          statuses[resolvedPath] = 'D';
        } else if (y !== ' ' && y !== '?') {
          statuses[resolvedPath] = y as GitFileStatusCode;
        } else if (x !== ' ' && x !== '?') {
          statuses[resolvedPath] = x as GitFileStatusCode;
        } else {
          statuses[resolvedPath] = 'M'; // fallback
        }
      }

      return { statuses, gitRoot };
    } catch {
      return { statuses: {}, gitRoot: '' };
    }
  }

  async getBlame(folderPath: string, filePath: string): Promise<BlameResponse> {
    try {
      const headSha = (await execGit(['rev-parse', 'HEAD'], folderPath)).trim();
      const cacheKey = filePath + ':' + headSha;

      const cached = this.blameCache.get(cacheKey);
      if (cached) {
        return cached.data;
      }

      const output = await execGit(['blame', '--porcelain', 'HEAD', '--', filePath], folderPath);
      const lines = output.split('\n');
      const result: BlameLineEntry[] = [];

      let i = 0;
      while (i < lines.length) {
        const headerLine = lines[i];
        // Porcelain commit block header: <40-char sha> <orig-line> <final-line> [<num-lines>]
        const headerMatch = headerLine.match(/^([0-9a-f]{40}) \d+ (\d+)/);
        if (!headerMatch) {
          i++;
          continue;
        }

        const hash = headerMatch[1];
        const lineNo = parseInt(headerMatch[2], 10);

        let author = '';
        let authorTime = 0;
        let summary = '';

        i++;
        // Read field lines until we hit the tab-prefixed content line
        while (i < lines.length && !lines[i].startsWith('\t')) {
          const fieldLine = lines[i];
          if (fieldLine.startsWith('author ')) {
            author = fieldLine.slice('author '.length);
          } else if (fieldLine.startsWith('author-time ')) {
            authorTime = parseInt(fieldLine.slice('author-time '.length), 10);
          } else if (fieldLine.startsWith('summary ')) {
            summary = fieldLine.slice('summary '.length);
          }
          i++;
        }

        // Tab-prefixed line is the actual source line content — skip it
        i++;

        const date = new Date(authorTime * 1000).toISOString();
        result.push({ lineNo, hash, author, date, summary });
      }

      const data: BlameResponse = { lines: result };
      this.blameCache.set(cacheKey, { data, headSha });
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get blame';
      return { lines: [], error: message };
    }
  }

  async revertFileToHead(folderPath: string, filePath: string): Promise<PatchOperationResponse> {
    try {
      await execGitWithStderr(['restore', '--source=HEAD', '--', filePath], folderPath);
      return { success: true };
    } catch (err) {
      const e = err as { message?: string; stderr?: string };
      return { success: false, error: e.stderr || e.message || 'Failed to revert file' };
    }
  }

  async addToGitignore(folderPath: string, filePath: string): Promise<PatchOperationResponse> {
    try {
      const gitignorePath = path.join(folderPath, '.gitignore');
      await appendFile(gitignorePath, `${filePath}\n`);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}
