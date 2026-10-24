import { execFile } from 'child_process';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { appendFile, readFile } from 'fs/promises';
import path from 'path';
import type { ShellGitContext, GitSummary, GitSummaryFile, GitDiffResponse, GitFileStatusCode, GitFileStatusResponse, PatchSelectionRequest, PatchOperationResponse, CommitResponse, GitLogResponse, GitBranchesResponse, DiffFileResponse, StructuredDiffResponse, StructuredHunk, SideBySideLine, DiffToken, BlameResponse, BlameLineEntry, WorktreeMergePreviewResponse, MergePreviewFile, GitCommitSummary, GitCommitRef, GitCommitDetail, GitCommitFile, GitHistoryResponse, GitRefsResponse, GitBranchInfo, GitWorktreeInfo } from '@argus/shared';

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
/** `git push` (Beta F8 Finish) talks to the network; give it longer. */
const PUSH_TIMEOUT_MS = 60_000;
// blameCache keys on filePath+headSha, so every commit adds a fresh entry per
// file touched instead of invalidating one — cap it so a long-lived session
// with lots of commits doesn't grow the map unbounded.
const BLAME_CACHE_MAX_ENTRIES = 500;

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

/** A single file whose diff is longer than this is left out of a capped diff. */
const OVERSIZED_FILE_LINES = 20_000;

function isMaxBuffer(err: unknown): boolean {
  return (err as { code?: string }).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
}

/**
 * `git diff <args>` that survives a diff too big for one response. One huge file
 * (a staged deletion of a 600k-line JSON) used to overflow maxBuffer and fail the
 * whole Diff panel. On overflow, re-run without files over OVERSIZED_FILE_LINES
 * and append a header-only stub for each, so they still list and can be staged
 * as a whole. Their paths are added to `oversized`.
 */
async function diffCapped(args: string[], cwd: string, oversized: Set<string>): Promise<string> {
  try {
    return await execGit(args, cwd);
  } catch (err) {
    if (!isMaxBuffer(err)) throw err;
  }
  // Renames off in the fallback: numstat reports a rename as `a => b`, which
  // couldn't be excluded by path. They show as delete + add instead.
  const stat = await execGit([...args, '--no-renames', '--numstat', '--summary', '-z'], cwd);
  const { big, modes } = parseNumstatZ(stat);
  if (big.length === 0) throw new Error('diff too large to display');
  const body = await execGit(
    // numstat paths are repo-root relative; :(top) anchors the pathspecs there
    // too, so this also works when the session folder is a repo subdirectory.
    [...args, '--no-renames', '--', ':(top)', ...big.map((p) => `:(top,exclude,literal)${p}`)],
    cwd,
  );
  for (const p of big) oversized.add(p);
  const stubs = big.map((p) => {
    const mode = modes.get(p);
    if (mode?.kind === 'delete') return `diff --git a/${p} b/${p}\ndeleted file mode ${mode.mode}\n--- a/${p}\n+++ /dev/null\n`;
    if (mode?.kind === 'create') return `diff --git a/${p} b/${p}\nnew file mode ${mode.mode}\n--- /dev/null\n+++ b/${p}\n`;
    return `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n`;
  });
  return body + stubs.join('');
}

/**
 * Parse `git diff --numstat --summary -z`: NUL-terminated `add\tdel\tpath`
 * records, then newline-separated ` create|delete mode <mode> <path>` lines.
 * Returns files over OVERSIZED_FILE_LINES and each file's create/delete mode.
 */
export function parseNumstatZ(out: string): { big: string[]; modes: Map<string, { kind: 'create' | 'delete'; mode: string }> } {
  const big: string[] = [];
  const modes = new Map<string, { kind: 'create' | 'delete'; mode: string }>();
  for (const rec of out.split('\0')) {
    for (const line of rec.split('\n')) {
      const num = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
      if (num) {
        const lines = (num[1] === '-' ? 0 : Number(num[1])) + (num[2] === '-' ? 0 : Number(num[2]));
        if (lines > OVERSIZED_FILE_LINES) big.push(num[3]);
        continue;
      }
      const sum = /^ (create|delete) mode (\d+) (.+)$/.exec(line);
      if (sum) modes.set(sum[3], { kind: sum[1] as 'create' | 'delete', mode: sum[2] });
    }
  }
  return { big, modes };
}

// Like execGit but tolerant of the exit-1 that `git diff --no-index` returns when
// the two paths differ (which is always, comparing a file against /dev/null). Only
// a non-1 failure (real error, maxBuffer overflow) rejects.
function execGitDiffNoIndex(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(GIT_PATH, args, { cwd, timeout: TIMEOUT_MS, maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
      if (err && (err as { code?: number }).code !== 1) {
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
  /** Folder → repo root for summary(); dropped when the folder stops being a repo. */
  private summaryRoots = new Map<string, string>();

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
      // Read-only: --no-optional-locks so this never takes index.lock (an
      // agent's concurrent `git commit` would fail with "index.lock exists").
      const output = await execGit(['--no-optional-locks', 'status', '--porcelain'], worktreePath);
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

  // ── Beta F8: worktree lifecycle ──────────────────────────────────────────

  /** The branch's upstream (`origin/feat/x`), or null when it has none. */
  async upstreamOf(folder: string): Promise<string | null> {
    try {
      const out = (await execGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], folder)).trim();
      return out || null;
    } catch {
      return null;
    }
  }

  /** Epoch ms of HEAD's commit; null when there is none (or not a repo). */
  async lastCommitTime(folder: string): Promise<number | null> {
    try {
      const secs = parseInt((await execGit(['log', '-1', '--format=%ct'], folder)).trim(), 10);
      return Number.isFinite(secs) ? secs * 1000 : null;
    } catch {
      return null;
    }
  }

  /** URL of a remote (default `origin`), or null. */
  async remoteUrl(folder: string, remote = 'origin'): Promise<string | null> {
    try {
      const out = (await execGit(['remote', 'get-url', '--', remote], folder)).trim();
      return out || null;
    } catch {
      return null;
    }
  }

  /** Stage everything (incl. untracked) and commit. */
  async commitAll(folder: string, message: string): Promise<CommitResponse> {
    try {
      await execGitWithStderr(['add', '-A'], folder);
    } catch (err) {
      const e = err as { message?: string; stderr?: string };
      return { success: false, error: e.stderr || e.message || 'git add failed' };
    }
    return this.commit(folder, message, false);
  }

  /**
   * Push `branch`; with `setUpstream`, publish it to origin and track it. The
   * caller validates `branch` (isSafeRef). Longer timeout than other git calls
   * (a push talks to the network), and no credential prompt — it would hang
   * with no terminal to answer it.
   */
  async pushBranch(folder: string, branch: string, setUpstream: boolean): Promise<PatchOperationResponse> {
    const args = setUpstream ? ['push', '--set-upstream', 'origin', `refs/heads/${branch}:refs/heads/${branch}`] : ['push'];
    return new Promise((resolve) => {
      execFile(GIT_PATH, args, {
        cwd: folder,
        timeout: PUSH_TIMEOUT_MS,
        maxBuffer: 5 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      }, (err, _stdout, stderr) => {
        if (err) resolve({ success: false, error: (stderr || '').trim() || err.message || 'Push failed' });
        else resolve({ success: true });
      });
    });
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

  private async getBranchDiff(folderPath: string, oversized: Set<string>): Promise<string> {
    try {
      return await diffCapped(['diff', 'HEAD'], folderPath, oversized);
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

  // All-added diff for the untracked files so they preview like tracked changes.
  // Each file is diffed against /dev/null; a per-file failure (binary, oversize)
  // is dropped rather than failing the whole diff.
  private async getUntrackedDiff(folderPath: string, paths: string[]): Promise<string> {
    if (paths.length === 0) return '';
    const diffs = await Promise.all(
      paths.map(async (p) => {
        // `--` stops git treating a path as an option; also skip any leading-dash
        // path defensively so a file named e.g. `-foo` can't inject git flags.
        if (p.startsWith('-')) return '';
        try {
          return await execGitDiffNoIndex(['diff', '--no-index', '--no-color', '--', '/dev/null', p], folderPath);
        } catch {
          return '';
        }
      }),
    );
    return diffs.filter(Boolean).join('\n');
  }

  async getDiff(folderPath: string): Promise<GitDiffResponse> {
    const isRepo = await this.isGitRepo(folderPath);
    if (!isRepo) {
      return { unstaged: '', staged: '', branch: '', untracked: [], untrackedDiff: '', error: 'Not a git repository' };
    }

    try {
      const oversized = new Set<string>();
      const [unstaged, staged, branch, untracked] = await Promise.all([
        diffCapped(['diff'], folderPath, oversized),
        diffCapped(['diff', '--cached'], folderPath, oversized),
        this.getBranchDiff(folderPath, oversized),
        this.getUntrackedFiles(folderPath),
      ]);
      const untrackedDiff = await this.getUntrackedDiff(folderPath, untracked);
      return { unstaged, staged, branch, untracked, untrackedDiff, ...(oversized.size ? { oversized: [...oversized].sort() } : {}) };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get diff';
      return { unstaged: '', staged: '', branch: '', untracked: [], untrackedDiff: '', error: message };
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
      // Polled every 10s per session (SessionManager.pollGitStatus). Plain
      // `git status` refreshes the index stat cache and so takes index.lock —
      // racing an agent's own `git commit`, which then fails with "index.lock
      // exists". --no-optional-locks skips that opportunistic write.
      const output = await execGit(['--no-optional-locks', 'status', '--porcelain'], folderPath);
      return output.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Branch, ahead/behind its upstream, and changed-file count for a plain Shell
   * session's cwd — one `git status` call. null when the cwd isn't in a repo.
   */
  async shellContext(cwd: string): Promise<ShellGitContext | null> {
    let out: string;
    let root: string;
    try {
      [out, root] = await Promise.all([
        execGit(['--no-optional-locks', 'status', '--porcelain=v2', '--branch'], cwd),
        execGit(['rev-parse', '--show-toplevel'], cwd),
      ]);
    } catch {
      return null;
    }
    return parseShellContext(out, root.trim());
  }

  /**
   * Branch, upstream, ahead/behind and the changed files of `folder` — one
   * read-only `git status` (Session Inspector). null when it isn't a repo.
   */
  async summary(folder: string): Promise<GitSummary | null> {
    let out: string;
    let root = this.summaryRoots.get(folder);
    try {
      // Polled every few seconds: the repo root of a folder doesn't move, so
      // resolve it once and keep each poll to a single `git status`.
      if (root === undefined) {
        [out, root] = await Promise.all([
          execGit(['--no-optional-locks', 'status', '--porcelain=v2', '--branch', '-z'], folder),
          execGit(['rev-parse', '--show-toplevel'], folder).then((r) => r.trim()),
        ]);
        this.summaryRoots.set(folder, root);
      } else {
        out = await execGit(['--no-optional-locks', 'status', '--porcelain=v2', '--branch', '-z'], folder);
      }
    } catch {
      this.summaryRoots.delete(folder);
      return null;
    }
    return parseGitSummary(out, root);
  }

  /** Repo root and checked-out branch of `folder` in one `git rev-parse`;
   *  branch is `HEAD` when detached. null when not a repo. */
  async headInfo(folder: string): Promise<{ root: string; branch: string } | null> {
    try {
      const [root, branch] = (await execGit(['rev-parse', '--show-toplevel', '--abbrev-ref', 'HEAD'], folder))
        .split('\n').map((l) => l.trim());
      return root && branch ? { root, branch } : null;
    } catch {
      return null;
    }
  }

  // ── Git Manager, read-only (B5) ──────────────────────────────────────────
  // Callers validate `ref`/`rev` (routes/git.ts); they also reach git after
  // --end-of-options, so even a value that slipped through can't be an option.

  /**
   * One page of `git log` for `folder`, newest first, optionally limited to
   * the commits touching `path` (relative to `folder`; callers contain it with
   * pathScope). `commits` is null when the folder isn't a repo and [] on a repo
   * with no commits yet. Throws GitUnknownRefError on an unknown `ref`, and
   * git's own error on anything else.
   */
  async history(folder: string, opts: { skip: number; limit: number; ref?: string; path?: string }): Promise<GitHistoryResponse> {
    const skip = Math.max(0, Math.floor(opts.skip));
    const limit = Math.min(Math.max(1, Math.floor(opts.limit)), GIT_HISTORY_MAX_LIMIT);
    let out: string;
    try {
      out = await execGit(
        // One extra commit tells whether another page follows.
        // :(literal) keeps a path from being read as pathspec magic.
        ['log', '-z', '--decorate=full', `--format=${LOG_FORMAT}`, `--skip=${skip}`, `-n${limit + 1}`, '--end-of-options', opts.ref ?? 'HEAD', '--',
          ...(opts.path ? [`:(literal)${opts.path}`] : [])],
        folder,
      );
    } catch (err) {
      // Only a failure pays for working out why: not a repo, an unborn HEAD
      // (fresh `git init`, no history rather than an error), or a bad ref.
      if (!(await this.isGitRepo(folder))) return { commits: null, hasMore: false };
      if (!opts.ref && !(await this.resolveCommit(folder, 'HEAD'))) return { commits: [], hasMore: false };
      if (opts.ref && !(await this.resolveCommit(folder, opts.ref))) throw new GitUnknownRefError(opts.ref);
      throw err;
    }
    const commits = parseGitLog(out);
    return { commits: commits.slice(0, limit), hasMore: commits.length > limit };
  }

  /** Full hash of `rev` when it names a commit, else null. */
  async resolveCommit(folder: string, rev: string): Promise<string | null> {
    try {
      const sha = (await execGit(['rev-parse', '--verify', '--quiet', '--end-of-options', `${rev}^{commit}`], folder)).trim();
      return sha || null;
    } catch {
      return null;
    }
  }

  /**
   * Message, metadata, touched files and diff of one commit, against its first
   * parent (a merge shows what it brought in). The diff goes through
   * diffCapped: oversized files are stubbed, and a diff that is still too large
   * is dropped (`truncated`), leaving the file list. null for an unknown commit.
   */
  async commitDetail(folder: string, rev: string): Promise<GitCommitDetail | null> {
    // The metadata read doubles as the lookup: `^{commit}` refuses a tree or
    // blob, and the full hash it prints names the commit for the diff reads.
    let meta: string;
    try {
      meta = await execGit(['show', '-s', '-z', '--decorate=full', `--format=${DETAIL_FORMAT}`, '--end-of-options', `${rev}^{commit}`], folder);
    } catch {
      return null;
    }
    const detail = parseCommitDetail(meta);
    if (!detail) return null;
    const sha = detail.hash;
    // Same diff options for the file list and the patch, so they agree.
    const diffOpts = ['-M', '--diff-merges=first-parent', '--no-color', '--no-ext-diff', '--no-textconv'];
    const oversized = new Set<string>();
    const [numstat, diff] = await Promise.all([
      execGit(['show', '--format=', '--numstat', '-z', ...diffOpts, sha], folder),
      diffCapped(['show', '--format=', ...diffOpts, sha], folder, oversized).catch((err: unknown) => {
        if (isMaxBuffer(err) || (err instanceof Error && err.message === 'diff too large to display')) return null;
        throw err;
      }),
    ]);
    return {
      ...detail,
      files: parseNumstatFiles(numstat),
      diff: diff ?? '',
      ...(oversized.size && diff !== null ? { oversized: [...oversized].sort() } : {}),
      ...(diff === null ? { truncated: true } : {}),
    };
  }

  /** Local and remote-tracking branches plus worktrees of `folder`'s repo; null when not a repo. */
  async refs(folder: string): Promise<GitRefsResponse['refs']> {
    let root: string;
    try {
      root = (await execGit(['rev-parse', '--show-toplevel'], folder)).trim();
    } catch {
      return null;
    }
    const [refsOut, worktreesOut] = await Promise.all([
      execGit(['for-each-ref', '--sort=-committerdate', `--format=${REF_FORMAT}`, 'refs/heads', 'refs/remotes'], folder),
      // Older gits lack `worktree list -z`; branches still show without it.
      execGit(['worktree', 'list', '--porcelain', '-z'], folder).catch(() => ''),
    ]);
    const branches = parseGitRefs(refsOut, root);
    return {
      root,
      current: branches.find((b) => b.current)?.name ?? null,
      local: branches.filter((b) => b.ref.startsWith('refs/heads/')),
      remote: branches.filter((b) => b.ref.startsWith('refs/remotes/')),
      worktrees: parseWorktreeList(worktreesOut, root),
    };
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
      // Defense in depth (the route validates too): it becomes a bare argv word.
      if (resolvedBase.startsWith('-')) return { success: false, error: `Invalid base branch: "${resolvedBase}"` };

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
        execGit(['--no-optional-locks', 'status', '--porcelain', '--ignored'], folderPath), // read-only: never take index.lock
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
      while (this.blameCache.size > BLAME_CACHE_MAX_ENTRIES) {
        const oldestKey = this.blameCache.keys().next().value;
        if (oldestKey === undefined) break;
        this.blameCache.delete(oldestKey);
      }
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

  /**
   * Append one exact path to `<folderPath>/.gitignore`.
   *
   * The path used to be written verbatim: a name containing CR/LF injected extra
   * rules (e.g. `x\n!secret.env` or `x\n*`), and an unanchored relative name
   * matched that basename in every directory. Now: CR/LF (and other control
   * characters) are refused, the path is made repo-relative to the folder and
   * anchored with a leading `/`, and gitignore glob/escape characters are
   * backslash-escaped so the rule matches only that one path.
   */
  async addToGitignore(folderPath: string, filePath: string): Promise<PatchOperationResponse> {
    const rule = gitignoreRuleFor(folderPath, filePath);
    if (!rule) return { success: false, error: 'Invalid file path' };
    try {
      const gitignorePath = path.join(folderPath, '.gitignore');
      let prefix = '';
      try {
        const existing = await readFile(gitignorePath, 'utf8');
        if (existing.length > 0 && !existing.endsWith('\n')) prefix = '\n';
      } catch { /* no .gitignore yet */ }
      await appendFile(gitignorePath, `${prefix}${rule}\n`);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}

/**
 * The anchored `.gitignore` rule for one path inside `folderPath`, or null when
 * the path is unusable (control characters, escapes the folder, is the folder).
 */
export function gitignoreRuleFor(folderPath: string, filePath: string): string | null {
  if (!filePath || /[\x00-\x1f\x7f]/.test(filePath)) return null;
  const rel = path.relative(folderPath, path.resolve(folderPath, filePath));
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return null;
  const posix = rel.split(path.sep).join('/');
  // Escape gitignore metacharacters; a trailing space is significant only escaped.
  const escaped = posix.replace(/[\\*?[\]]/g, (c) => `\\${c}`).replace(/ $/, '\\ ');
  return `/${escaped}`;
}

/** Most files a git summary lists; the Inspector is a glance, the Diff has the rest. */
export const GIT_SUMMARY_MAX_FILES = 200;

function summaryStatus(xy: string): GitSummaryFile['status'] {
  const x = xy[0];
  const y = xy[1];
  const side = x !== '.' ? x : y;
  return side === 'A' || side === 'D' || side === 'R' || side === 'C' ? side : 'M';
}

/**
 * Parse `git status --porcelain=v2 --branch -z`. NUL-separated, so paths with
 * spaces or quotes arrive verbatim; a rename (`2 …`) carries its original path
 * in the following entry, which is skipped.
 */
export function parseGitSummary(out: string, root: string): GitSummary {
  let branch: string | null = null;
  let oid: string | null = null;
  let upstream: string | null = null;
  let ahead: number | null = null;
  let behind: number | null = null;
  let changes = 0;
  const files: GitSummaryFile[] = [];
  const push = (f: GitSummaryFile) => {
    changes++;
    if (files.length < GIT_SUMMARY_MAX_FILES) files.push(f);
  };
  const entries = out.split('\0');
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.startsWith('# branch.head ')) {
      const head = e.slice('# branch.head '.length).trim();
      branch = head === '(detached)' ? null : head;
    } else if (e.startsWith('# branch.oid ')) {
      const o = e.slice('# branch.oid '.length).trim();
      oid = o === '(initial)' ? null : o.slice(0, 7);
    } else if (e.startsWith('# branch.upstream ')) {
      upstream = e.slice('# branch.upstream '.length).trim() || null;
    } else if (e.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(e);
      if (m) {
        ahead = Number(m[1]);
        behind = Number(m[2]);
      }
    } else if (e.startsWith('1 ')) {
      // 1 XY sub mH mI mW hH hI path
      const parts = e.split(' ');
      push({ path: parts.slice(8).join(' '), status: summaryStatus(parts[1]), staged: parts[1][0] !== '.' });
    } else if (e.startsWith('2 ')) {
      // 2 XY sub mH mI mW hH hI Xscore path, then origPath as its own entry
      const parts = e.split(' ');
      push({ path: parts.slice(9).join(' '), status: summaryStatus(parts[1]), staged: parts[1][0] !== '.' });
      i++;
    } else if (e.startsWith('u ')) {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      push({ path: e.split(' ').slice(10).join(' '), status: 'U', staged: false });
    } else if (e.startsWith('? ')) {
      push({ path: e.slice(2), status: '?', staged: false });
    }
  }
  return { root, branch: branch ?? oid, detached: branch === null, ahead, behind, changes, upstream, files };
}

/** Parse `git status --porcelain=v2 --branch` into the Shell header's git context. */
export function parseShellContext(out: string, root: string): ShellGitContext {
  let branch: string | null = null;
  let oid: string | null = null;
  let ahead: number | null = null;
  let behind: number | null = null;
  let changes = 0;
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length).trim();
      branch = head === '(detached)' ? null : head;
    } else if (line.startsWith('# branch.oid ')) {
      const o = line.slice('# branch.oid '.length).trim();
      oid = o === '(initial)' ? null : o.slice(0, 7);
    } else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) {
        ahead = Number(m[1]);
        behind = Number(m[2]);
      }
    } else if (line.length > 0 && !line.startsWith('#')) {
      changes++;
    }
  }
  // Detached HEAD: show the short sha in place of a branch name.
  return { root, branch: branch ?? oid, detached: branch === null, ahead, behind, changes };
}

// ── Git Manager, read-only (B5): formats and parsers ─────────────────────────

/** history() was given a ref that names no commit. */
export class GitUnknownRefError extends Error {
  readonly ref: string;
  constructor(ref: string) {
    super(`Unknown ref: ${ref}`);
    this.ref = ref;
    this.name = 'GitUnknownRefError';
  }
}

/** Largest page `history()` returns. */
export const GIT_HISTORY_MAX_LIMIT = 200;

// NUL between fields, and `-z` makes NUL the record terminator too: no field
// but the free-text message can hold a NUL, and the message is always last.
const LOG_FIELDS = ['%H', '%h', '%P', '%an', '%ae', '%at', '%D', '%s'];
const LOG_FORMAT = LOG_FIELDS.join('%x00');
// %s as in the log (the whole first paragraph, joined), so list and detail agree.
const DETAIL_FORMAT = [...LOG_FIELDS.slice(0, 7), '%cn', '%ce', '%ct', '%s', '%B'].join('%x00');
// for-each-ref has no -z: NUL between fields, one ref per line (a subject is one line).
const REF_FORMAT = [
  '%(refname)', '%(refname:short)', '%(objectname:short)', '%(HEAD)', '%(upstream:short)',
  '%(upstream:track,nobracket)', '%(committerdate:unix)', '%(symref)', '%(worktreepath)', '%(contents:subject)',
].join('%00');

/**
 * Parse a `--decorate=full` %D: `HEAD -> refs/heads/main, refs/remotes/origin/main,
 * tag: refs/tags/v1`. Full names tell a local branch from a remote one; the
 * remote's HEAD pointer and the stash are noise and dropped. Exported for tests.
 */
export function parseDecorations(d: string): GitCommitRef[] {
  const refs: GitCommitRef[] = [];
  for (const raw of d ? d.split(', ') : []) {
    let r = raw.trim();
    let current = false;
    if (r.startsWith('HEAD -> ')) {
      current = true;
      r = r.slice('HEAD -> '.length);
    }
    if (r === 'HEAD') refs.push({ kind: 'head', name: 'HEAD' });
    else if (r.startsWith('tag: ')) refs.push({ kind: 'tag', name: r.slice('tag: '.length).replace(/^refs\/tags\//, '') });
    else if (r.startsWith('refs/heads/')) refs.push({ kind: 'branch', name: r.slice('refs/heads/'.length), ...(current ? { current } : {}) });
    else if (r.startsWith('refs/remotes/')) {
      if (!r.endsWith('/HEAD')) refs.push({ kind: 'remote', name: r.slice('refs/remotes/'.length) });
    }
  }
  return refs;
}

function summaryFrom(f: string[]): GitCommitSummary {
  return {
    hash: f[0],
    shortHash: f[1],
    parents: f[2] ? f[2].split(' ') : [],
    authorName: f[3],
    authorEmail: f[4],
    authorDate: Number(f[5]) * 1000,
    subject: f[7] ?? '',
    refs: parseDecorations(f[6]),
  };
}

/** Parse `git log -z --format=LOG_FORMAT`. Exported for tests. */
export function parseGitLog(out: string): GitCommitSummary[] {
  const fields = out.split('\0');
  const n = LOG_FIELDS.length;
  const commits: GitCommitSummary[] = [];
  for (let i = 0; i + n <= fields.length; i += n) {
    const f = fields.slice(i, i + n);
    // tformat may still put a newline between records in some gits.
    f[0] = f[0].replace(/^\n+/, '');
    if (!/^[0-9a-f]{7,64}$/.test(f[0])) continue;
    commits.push(summaryFrom(f));
  }
  return commits;
}

/** Parse `git show -s -z --format=DETAIL_FORMAT`. Exported for tests. */
export function parseCommitDetail(out: string): Omit<GitCommitDetail, 'files' | 'diff'> | null {
  const f = out.replace(/\0+$/, '').split('\0');
  if (f.length < 12 || !/^[0-9a-f]{7,64}$/.test(f[0])) return null;
  // The message may itself hold no NUL, but rejoin defensively.
  const message = f.slice(11).join('\0').trimEnd();
  return {
    ...summaryFrom([...f.slice(0, 7), f[10]]),
    committerName: f[7],
    committerEmail: f[8],
    commitDate: Number(f[9]) * 1000,
    message,
  };
}

/**
 * Parse `git show --numstat -z`: `add\tdel\tpath\0`, or for a rename/copy
 * `add\tdel\t\0old\0new\0`; `-` counts mean binary. Exported for tests.
 */
export function parseNumstatFiles(out: string): GitCommitFile[] {
  const toks = out.split('\0');
  const files: GitCommitFile[] = [];
  for (let i = 0; i < toks.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(toks[i].replace(/^\n+/, ''));
    if (!m) continue;
    const additions = m[1] === '-' ? null : Number(m[1]);
    const deletions = m[2] === '-' ? null : Number(m[2]);
    if (m[3] === '') {
      const oldPath = toks[i + 1];
      const path = toks[i + 2];
      i += 2;
      if (path === undefined) break;
      files.push({ path, ...(oldPath && oldPath !== path ? { oldPath } : {}), additions, deletions });
    } else {
      files.push({ path: m[3], additions, deletions });
    }
  }
  return files;
}

/** Parse `git for-each-ref --format=REF_FORMAT`. Exported for tests. */
export function parseGitRefs(out: string, root: string): GitBranchInfo[] {
  const branches: GitBranchInfo[] = [];
  for (const line of out.split('\n')) {
    if (!line) continue;
    const [ref, name, shortHash, head, upstream, track, date, symref, worktreePath, ...rest] = line.split('\0');
    // `origin/HEAD` is a pointer to another remote branch, not a branch.
    if (!ref || symref) continue;
    const isLocal = ref.startsWith('refs/heads/');
    const gone = track === 'gone';
    let ahead: number | null = null;
    let behind: number | null = null;
    if (isLocal && upstream && !gone) {
      ahead = Number(/ahead (\d+)/.exec(track)?.[1] ?? 0);
      behind = Number(/behind (\d+)/.exec(track)?.[1] ?? 0);
    }
    branches.push({
      name,
      ref,
      shortHash,
      current: head === '*',
      upstream: isLocal && upstream ? upstream : null,
      ahead,
      behind,
      upstreamGone: gone,
      date: Number(date) * 1000,
      subject: rest.join('\0'),
      ...(worktreePath && worktreePath !== root ? { worktreePath } : {}),
    });
  }
  return branches;
}

/** Parse `git worktree list --porcelain -z`. Exported for tests. */
export function parseWorktreeList(out: string, root: string): GitWorktreeInfo[] {
  const worktrees: GitWorktreeInfo[] = [];
  let cur: GitWorktreeInfo | null = null;
  for (const tok of out.split('\0')) {
    if (tok.startsWith('worktree ')) {
      const p = tok.slice('worktree '.length);
      cur = { path: p, branch: null, head: null, bare: false, detached: false, locked: false, prunable: false, current: p === root, main: worktrees.length === 0 };
      worktrees.push(cur);
    } else if (!cur) {
      continue;
    } else if (tok.startsWith('HEAD ')) {
      cur.head = tok.slice(5);
    } else if (tok.startsWith('branch ')) {
      cur.branch = tok.slice(7).replace(/^refs\/heads\//, '');
    } else if (tok === 'bare') {
      cur.bare = true;
    } else if (tok === 'detached') {
      cur.detached = true;
    } else if (tok === 'locked' || tok.startsWith('locked ')) {
      cur.locked = true;
    } else if (tok === 'prunable' || tok.startsWith('prunable ')) {
      cur.prunable = true;
    }
  }
  return worktrees;
}
