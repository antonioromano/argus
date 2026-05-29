import path from 'path';

/**
 * Resolve `rawPath` and confirm it stays inside `base` (or equals it). Returns the
 * normalized absolute path on success, or `null` when `rawPath` is missing,
 * relative, or escapes `base` (via `..`, etc.).
 *
 * Single source of truth for path containment — every filesystem-touching route
 * funnels through this so the "stay inside an allowed directory" rule can't drift
 * between endpoints.
 */
export function resolveWithinBase(base: string, rawPath: string): string | null {
  if (!rawPath || !path.isAbsolute(rawPath)) return null;
  const resolved = path.resolve(rawPath);
  if (resolved === base || resolved.startsWith(base + path.sep)) return resolved;
  return null;
}
