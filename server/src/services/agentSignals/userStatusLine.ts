import os from 'os';
import path from 'path';
import { readFileSync as fsReadFileSync, realpathSync } from 'fs';

/**
 * The user's own Claude status line, which Argus's status line wrapper
 * (`argus-signal --statusline`) must keep rendering unchanged.
 *
 * Argus passes its wrapper through `--settings`, which outranks every settings
 * file, so the line the user would otherwise see is resolved here at spawn and
 * handed to the wrapper. Precedence follows Claude Code's own (highest first):
 * the user's `--settings` flag, `<folder>/.claude/settings.local.json`,
 * `<folder>/.claude/settings.json`, then the user settings file
 * (`$CLAUDE_CONFIG_DIR/settings.json`, else `~/.claude/settings.json`).
 * Managed (enterprise) settings are not read: they outrank `--settings`, so a
 * managed status line replaces the wrapper and needs no help from Argus.
 *
 * Workspace trust: Claude runs a project's status line only after the folder's
 * trust dialog was accepted. The wrapper runs whatever command it is given, so
 * the two project files are read ONLY when Claude's own state says the folder
 * is trusted: `projects[<folder>].hasTrustDialogAccepted === true` in
 * `$CLAUDE_CONFIG_DIR/.claude.json`, else `~/.claude.json` (keys are absolute
 * folder paths; the real path and the given path are both checked, parents
 * are not). Checked afresh on every spawn; a missing or unreadable state file
 * means untrusted, and the user-level line (or none) is used.
 */

export interface UserStatusLine {
  command: string;
  padding?: number;
}

/** Commands longer than this are not carried (env var size, sanity). */
const MAX_COMMAND_LEN = 8192;

/** A settings object's `statusLine`, when it is a usable command. */
export function statusLineFrom(settings: unknown): UserStatusLine | undefined {
  if (!settings || typeof settings !== 'object') return undefined;
  const sl = (settings as { statusLine?: unknown }).statusLine;
  if (!sl || typeof sl !== 'object') return undefined;
  const { type, command, padding } = sl as { type?: unknown; command?: unknown; padding?: unknown };
  if (type !== 'command' || typeof command !== 'string') return undefined;
  const trimmed = command.trim();
  if (!trimmed || trimmed.length > MAX_COMMAND_LEN || trimmed.includes('\0')) return undefined;
  const out: UserStatusLine = { command: trimmed };
  if (typeof padding === 'number' && Number.isFinite(padding) && padding >= 0) out.padding = padding;
  return out;
}

export interface ResolveStatusLineOpts {
  readFileSync?: (p: string) => string;
  realpathSync?: (p: string) => string;
  home?: string;
  env?: NodeJS.ProcessEnv;
}

/** Claude's state file: `$CLAUDE_CONFIG_DIR/.claude.json`, else `~/.claude.json`. */
export function claudeStateFile(opts: ResolveStatusLineOpts = {}): string {
  const env = opts.env ?? process.env;
  return env.CLAUDE_CONFIG_DIR
    ? path.join(env.CLAUDE_CONFIG_DIR, '.claude.json')
    : path.join(opts.home ?? os.homedir(), '.claude.json');
}

/**
 * True only when Claude's state marks `folder` as trusted
 * (`projects[<folder>].hasTrustDialogAccepted === true`). Anything else —
 * missing file, bad JSON, no entry, a non-boolean — is untrusted.
 */
export function isFolderTrusted(folder: string, opts: ResolveStatusLineOpts = {}): boolean {
  const read = opts.readFileSync ?? ((p: string) => fsReadFileSync(p, 'utf8'));
  const realpath = opts.realpathSync ?? ((p: string) => realpathSync(p));
  let state: unknown;
  try {
    state = JSON.parse(read(claudeStateFile(opts)));
  } catch {
    return false;
  }
  const projects = (state as { projects?: unknown } | null)?.projects;
  if (!projects || typeof projects !== 'object' || Array.isArray(projects)) return false;
  const keys = new Set<string>([path.resolve(folder)]);
  try {
    keys.add(realpath(folder));
  } catch {
    /* folder gone: only the given path */
  }
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(projects, k)) continue;
    const entry = (projects as Record<string, unknown>)[k];
    if (entry && typeof entry === 'object' && (entry as { hasTrustDialogAccepted?: unknown }).hasTrustDialogAccepted === true) {
      return true;
    }
  }
  return false;
}

/**
 * The settings files that may supply a status line, highest precedence first.
 * The project files are included only for a trusted folder (see above).
 */
export function statusLineSettingsFiles(folder: string, opts: ResolveStatusLineOpts = {}): string[] {
  const env = opts.env ?? process.env;
  const userDir = env.CLAUDE_CONFIG_DIR || path.join(opts.home ?? os.homedir(), '.claude');
  const project = isFolderTrusted(folder, opts)
    ? [path.join(folder, '.claude', 'settings.local.json'), path.join(folder, '.claude', 'settings.json')]
    : [];
  return [...project, path.join(userDir, 'settings.json')];
}

/**
 * The effective status line for a Claude session in `folder`, or undefined when
 * the user has none. Trust is re-read on every call (never cached). A missing,
 * unreadable or malformed file is skipped, like a file with no usable
 * `statusLine`.
 */
export function resolveUserStatusLine(folder: string, opts: ResolveStatusLineOpts = {}): UserStatusLine | undefined {
  const read = opts.readFileSync ?? ((p: string) => fsReadFileSync(p, 'utf8'));
  for (const file of statusLineSettingsFiles(folder, opts)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(read(file));
    } catch {
      continue;
    }
    const sl = statusLineFrom(parsed);
    if (sl) return sl;
  }
  return undefined;
}
