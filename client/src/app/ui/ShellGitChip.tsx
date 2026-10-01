import { GitBranch } from 'lucide-react';
import type { ShellGitContext } from '@argus/shared';
import { Tooltip } from '../../components/primitives/index.js';
import { describeShellGit } from '../../utils/shellGit.js';

/**
 * Git context of a plain Shell's current directory: `⎇ branch ↑2 ↓1 ●3`.
 * Zero counts are omitted so a clean, synced repo reads as just the branch.
 */
export function ShellGitChip({ cwd, git }: { cwd: string; git: ShellGitContext }) {
  return (
    <Tooltip content={describeShellGit(cwd, git)}>
      <span className="argus-shell-git" data-testid="shell-git">
        <GitBranch size={10} strokeWidth={2} style={{ flexShrink: 0 }} />
        <span className="argus-shell-git-branch">{git.branch ?? 'empty'}</span>
        {!!git.ahead && <span className="argus-shell-git-ahead">↑{git.ahead}</span>}
        {!!git.behind && <span className="argus-shell-git-behind">↓{git.behind}</span>}
        {git.changes > 0 && <span className="argus-shell-git-changes">●{git.changes}</span>}
      </span>
    </Tooltip>
  );
}
