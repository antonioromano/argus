import { Cloud, GitBranch, LocateFixed, Tag } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { GitCommitRef } from '@argus/shared';
import { Icon } from '../../../components/primitives/index.js';

const REF_ICON: Record<GitCommitRef['kind'], LucideIcon> = {
  branch: GitBranch,
  remote: Cloud,
  tag: Tag,
  head: LocateFixed,
};

const REF_TITLE: Record<GitCommitRef['kind'], string> = {
  branch: 'Branch',
  remote: 'Remote branch',
  tag: 'Tag',
  head: 'Detached HEAD',
};

/** Branch / remote / tag labels of a commit. `max` folds the rest into "+n". */
export function RefChips({ refs, max }: { refs: readonly GitCommitRef[]; max?: number }) {
  if (refs.length === 0) return null;
  const shown = max !== undefined && refs.length > max ? refs.slice(0, max) : refs;
  const hidden = refs.length - shown.length;
  return (
    <span className="argus-git-refs">
      {shown.map((r) => (
        <span
          key={`${r.kind}:${r.name}`}
          className="argus-git-ref"
          data-kind={r.kind}
          data-current={r.current || undefined}
          title={`${REF_TITLE[r.kind]}${r.current ? ' (checked out)' : ''}: ${r.name}`}
        >
          <Icon icon={REF_ICON[r.kind]} size={10} strokeWidth={2} />
          <span className="argus-git-ref-name">{r.name}</span>
        </span>
      ))}
      {hidden > 0 && (
        <span className="argus-git-ref" data-kind="more" title={refs.slice(shown.length).map((r) => r.name).join(', ')}>
          +{hidden}
        </span>
      )}
    </span>
  );
}
