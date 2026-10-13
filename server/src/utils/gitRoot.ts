import { execFile, execFileSync } from 'child_process';

// Resolve the git binary path once at startup.
const GIT_PATH = (() => {
  try {
    return execFileSync('which', ['git'], { encoding: 'utf-8' }).trim();
  } catch {
    return 'git';
  }
})();

/** How long a folder → repo-root answer is reused. Short: a `git init` or a
 *  moved repo is picked up within seconds, and the cache only exists to stop a
 *  burst of REST calls (every Diff-panel load hits both stores) re-forking git. */
export const GIT_ROOT_TTL_MS = 30_000;

/** `git rev-parse --show-toplevel` in `cwd`, rejecting when it is not a repo. */
export type ShowToplevel = (cwd: string) => Promise<string>;

const execShowToplevel: ShowToplevel = (cwd) =>
  new Promise((resolve, reject) => {
    execFile(GIT_PATH, ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf-8' }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });

/**
 * Build a cached folder → git-root resolver. Async (never blocks the event loop
 * on the request path, unlike the execFileSync it replaces) and deduped: callers
 * asking for the same folder while a lookup is in flight share it. A folder
 * outside any repository resolves to itself, as before.
 */
export function createGitRootResolver(
  showToplevel: ShowToplevel = execShowToplevel,
  ttlMs: number = GIT_ROOT_TTL_MS,
  now: () => number = Date.now,
): (folderPath: string) => Promise<string> {
  const cache = new Map<string, { root: Promise<string>; at: number }>();
  return (folderPath) => {
    const hit = cache.get(folderPath);
    if (hit && now() - hit.at < ttlMs) return hit.root;
    const root = showToplevel(folderPath).catch(() => folderPath);
    cache.set(folderPath, { root, at: now() });
    return root;
  };
}

/** Process-wide resolver shared by the per-repo persistence stores. */
export const resolveGitRoot = createGitRootResolver();
