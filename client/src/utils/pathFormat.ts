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
