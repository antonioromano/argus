import parseDiff from 'parse-diff';
import type { File as DiffFile } from 'parse-diff';
import type { WorktreeFinishInfo } from '@argus/shared';
import { api } from '../../services/api.js';

/** Beta F8 Finish sheet helpers (kept out of the component file for fast refresh). */

const CONVENTIONAL = new Set(['feat', 'fix', 'chore', 'docs', 'refactor', 'test', 'perf', 'ci', 'build', 'style']);

/** A commit message from the branch name: `argus/feat/add-login` → `feat: add login`. */
export function defaultCommitMessage(branch: string): string {
  const parts = branch.replace(/^argus\//, '').split('/').filter(Boolean);
  const words = (s: string) => s.replace(/[-_]+/g, ' ').trim();
  if (parts.length >= 2 && CONVENTIONAL.has(parts[0].toLowerCase())) {
    return `${parts[0].toLowerCase()}: ${words(parts.slice(1).join(' '))}`;
  }
  return words(parts[parts.length - 1] ?? branch) || branch;
}

export type FinishState =
  | { ok: true; info: WorktreeFinishInfo; files: DiffFile[] | null }
  | { ok: false; error: string };

/** Finish info plus the uncommitted changes (vs HEAD, untracked included).
 *  `files` is null when the diff could not be read — keep what is shown. */
export async function fetchFinishState(sessionId: string): Promise<FinishState> {
  try {
    const [info, diff] = await Promise.all([
      api.getWorktreeFinishInfo(sessionId),
      api.getSessionDiff(sessionId).catch(() => null),
    ]);
    let files: DiffFile[] | null = null;
    if (diff) {
      const text = [diff.branch, diff.untrackedDiff].filter(Boolean).join('\n');
      files = text ? parseDiff(text) : [];
    }
    return { ok: true, info, files };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not read the worktree' };
  }
}
