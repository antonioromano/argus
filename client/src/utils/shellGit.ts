import type { ShellGitContext } from '@argus/shared';

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Tooltip body: where the shell is and what each number means. */
export function describeShellGit(cwd: string, git: ShellGitContext): string {
  const parts = [cwd];
  parts.push(git.detached ? `detached at ${git.branch ?? '?'}` : `on ${git.branch ?? '(no commits yet)'}`);
  if (git.ahead === null) parts.push('no upstream');
  else {
    if (git.ahead > 0) parts.push(`${plural(git.ahead, 'commit', 'commits')} to push`);
    if (git.behind && git.behind > 0) parts.push(`${plural(git.behind, 'commit', 'commits')} to pull`);
    if (git.ahead === 0 && !git.behind) parts.push('in sync with upstream');
  }
  parts.push(git.changes > 0 ? `${plural(git.changes, 'changed file', 'changed files')}` : 'clean');
  return parts.join(' · ');
}
