/** Characters that are safe unquoted in POSIX shells. */
const SAFE_PATH_RE = /^[A-Za-z0-9_./@:+-]+$/;

/**
 * Quotes a single path for shell input if it contains spaces or shell-special
 * characters. Escapes embedded backslashes and double quotes.
 * Returns an empty string unchanged.
 */
export function formatPathForPty(path: string): string {
  if (!path) return path;
  if (SAFE_PATH_RE.test(path)) return path;
  const escaped = path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Formats an array of paths for pty input: each path is quoted if necessary,
 * then joined with a single space. Empty strings are filtered out.
 */
export function formatPathsForPty(paths: string[]): string {
  return paths
    .filter(p => p.length > 0)
    .map(formatPathForPty)
    .join(' ');
}

/** `abs` relative to `root` for display; paths outside `root` (including a sibling
 *  that merely shares its prefix, like `/repo2` for `/repo`) are returned as-is. */
export function relativeTo(root: string, abs: string): string {
  const base = root.endsWith('/') ? root : `${root}/`;
  return abs.startsWith(base) ? abs.slice(base.length) : abs;
}
