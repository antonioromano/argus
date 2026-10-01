import type { SessionInfo } from '@argus/shared';

/** Folder the Diff / Files workbenches operate on: a plain Shell follows its `cd`
 *  into a repo (mirrors server/src/utils/workRoot.ts). */
export function workRoot(session: Pick<SessionInfo, 'folderPath' | 'shellGit'>): string {
  return session.shellGit?.root ?? session.folderPath;
}
