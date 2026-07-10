import fs from 'fs';
import path from 'path';

/**
 * Resolve the "real" (symlink-followed) path of `target`. If `target` doesn't
 * exist yet (the "creating a new file" case), walk up to the nearest existing
 * ancestor, resolve THAT through symlinks, and re-attach the trailing segments.
 *
 * Returns null only if nothing along the path can be resolved (shouldn't happen
 * for an absolute path, since the filesystem root always exists).
 *
 * This is what lets the containment check see through a symlink that lexically
 * lives inside the base but points outside it — e.g. a session folder holding a
 * symlink to `~/.ssh`, or a symlinked parent dir a new file is written into.
 */
function realpathNearest(target: string): string | null {
  let current = target;
  const trailing: string[] = [];
  // Walk up until realpathSync succeeds; peel non-existent segments off the tail.
  while (true) {
    try {
      const real = fs.realpathSync(current);
      return trailing.length ? path.join(real, ...trailing) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return null; // reached the root without resolving
      trailing.unshift(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Defense-in-depth re-check on top of the lexical containment test: confirm that
 * the symlink-resolved `resolved` still lands inside the symlink-resolved `base`.
 * The lexical check alone can be fooled by a symlink whose own path is inside the
 * base but whose target escapes it.
 *
 * Fails OPEN (returns true) only when the base itself can't be resolved — in that
 * case the base directory doesn't exist, so no filesystem operation could succeed
 * anyway, and we don't want to regress the pre-existing lexical-only behavior.
 */
function realpathContained(base: string, resolved: string): boolean {
  let realBase: string;
  try {
    realBase = fs.realpathSync(base);
  } catch {
    return true; // base doesn't exist / can't resolve — lexical check stands
  }
  const realTarget = realpathNearest(resolved);
  if (realTarget === null) return true; // couldn't resolve anything — don't regress
  return realTarget === realBase || realTarget.startsWith(realBase + path.sep);
}

/**
 * Resolve `rawPath` and confirm it stays inside `base` (or equals it). Returns the
 * normalized absolute path on success, or `null` when `rawPath` is missing,
 * relative, or escapes `base` (via `..`, a symlink pointing outside, etc.).
 *
 * Single source of truth for path containment — every filesystem-touching route
 * funnels through this so the "stay inside an allowed directory" rule can't drift
 * between endpoints.
 */
export function resolveWithinBase(base: string, rawPath: string): string | null {
  if (!rawPath || !path.isAbsolute(rawPath)) return null;
  const resolved = path.resolve(rawPath);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  // Lexical check passed; re-verify through symlinks before trusting the path.
  if (!realpathContained(base, resolved)) return null;
  return resolved;
}

/**
 * Like resolveWithinBase, but `rawPath` may be relative to `base` (git mutation
 * routes pass repo-relative file paths). Resolves against `base`, then confirms
 * containment. Returns the normalized absolute path, or null on escape/empty.
 */
export function resolveRelativeWithinBase(base: string, rawPath: string): string | null {
  if (!rawPath) return null;
  const resolved = path.resolve(base, rawPath);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  // Lexical check passed; re-verify through symlinks before trusting the path.
  if (!realpathContained(base, resolved)) return null;
  return resolved;
}
