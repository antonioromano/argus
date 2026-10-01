import type { ShellGitContext } from '@argus/shared';

/**
 * The folder a session's Diff / Files / symbol routes operate on. For agent
 * sessions that is the folder they were created in. A plain Shell follows its
 * `cd`: inside a repo it is that repo's root, otherwise its creation folder.
 * Widening the scope this way grants nothing new — whoever can drive the Shell
 * can already run any command in any folder.
 */
export function workRootOf(session: { folderPath: string; shellGit?: ShellGitContext | null }): string {
  return session.shellGit?.root ?? session.folderPath;
}
