import fs from 'fs';
import path from 'path';
import type { AutoApprovalRule, AutoApprovalTool } from '@argus/shared';
import { AUTO_APPROVAL_TOOLS } from '../../constants/autoApproval.js';

/**
 * F5 auto-approval matcher. Pure decision logic, no I/O beyond realpath.
 *
 * The contract is one-directional: a match yields "allow", anything else yields
 * nothing, and Claude's own permission flow (including the user's deny/ask
 * rules, which Claude still evaluates after a hook "allow") takes over. So every
 * doubt here — a parse failure, an odd character, a path we cannot resolve —
 * resolves to "no match", never to "allow".
 */

const MAX_COMMAND = 4096;
const MAX_PREFIX = 200;
const MAX_GLOB = 200;
const SUMMARY_MAX = 120;

/**
 * Characters that chain, substitute, redirect, escape or group in a POSIX shell.
 * A command containing any of them never matches, so `git status; rm -rf ~`,
 * `git status && x`, `git status | sh`, `git status $(x)`, `` `x` ``,
 * `git status > ~/.zshenv` and `git status\nrm` cannot ride on a `git status`
 * prefix. `$` covers `$(…)`, `${…}` and `$VAR`; `\` covers escaped newlines;
 * `&` covers `&&` and a trailing `&`.
 */
const SHELL_META = /[;&|`$<>\\(){}\n\r]/;
/** Only printable ASCII (after tabs become spaces): rules out control chars,
 *  NUL, and Unicode look-alikes of spaces and separators. */
const NON_PRINTABLE_ASCII = /[^\x20-\x7e]/;

/** Write-capable file tools: these never touch the protected paths below. */
const WRITE_TOOLS: ReadonlySet<AutoApprovalTool> = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
/** Path segments (compared lowercased: macOS volumes are case-insensitive) that
 *  a write rule never auto-approves, whatever its glob: editing them changes the
 *  agent's own permissions, hooks or MCP servers, or git's hooks/config. */
const PROTECTED_SEGMENTS = new Set(['.git', '.claude']);
const PROTECTED_BASENAMES = new Set(['.mcp.json', '.envrc', '.gitmodules']);

export function isAutoApprovalTool(v: unknown): v is AutoApprovalTool {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(AUTO_APPROVAL_TOOLS, v);
}

/** Trim and collapse runs of spaces/tabs, so spacing cannot dodge a prefix. */
export function normalizeCommand(cmd: string): string {
  return cmd.replace(/[ \t]+/g, ' ').trim();
}

/** True when the command is safe to compare against a prefix at all. */
export function isPlainCommand(cmd: string): boolean {
  return !SHELL_META.test(cmd) && !NON_PRINTABLE_ASCII.test(cmd.replace(/\t/g, ' '));
}

/** Prefix match on a word boundary: `git status` matches `git status -s`, not `git statusx`. */
export function matchBashPrefix(prefix: string, rawCommand: unknown): boolean {
  if (typeof rawCommand !== 'string' || rawCommand.length === 0 || rawCommand.length > MAX_COMMAND) return false;
  if (!isPlainCommand(rawCommand)) return false;
  const cmd = normalizeCommand(rawCommand);
  const p = normalizeCommand(prefix);
  if (!p) return false;
  return cmd === p || cmd.startsWith(`${p} `);
}

/** `*` = one segment's characters, `**` = any depth, `?` = one character. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^$()|[\]{}\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * Realpath of `target`, or of its nearest existing ancestor with the missing
 * tail re-attached (a Write to a new file). Uses the native realpath so the
 * result carries the volume's canonical case.
 */
export function realpathNearest(target: string): string | null {
  let current = target;
  const trailing: string[] = [];
  for (;;) {
    try {
      const real = fs.realpathSync.native(current);
      return trailing.length ? path.join(real, ...trailing) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return null;
      trailing.unshift(path.basename(current));
      current = parent;
    }
  }
}

/**
 * The folder-relative path of `rawPath`, resolved through symlinks, or null if
 * it is not absolute, is the folder itself, or lands outside `folderReal`
 * (`..` segments, a symlink pointing out, a different volume path).
 */
export function relativeInside(folderReal: string, rawPath: unknown): string | null {
  if (typeof rawPath !== 'string' || !rawPath || rawPath.length > 4096) return null;
  if (!path.isAbsolute(rawPath) || /[\x00-\x1f\x7f]/.test(rawPath)) return null;
  const real = realpathNearest(path.resolve(rawPath));
  if (!real || !real.startsWith(folderReal + path.sep)) return null;
  const rel = path.relative(folderReal, real);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

function isProtected(rel: string): boolean {
  const segs = rel.toLowerCase().split('/');
  if (segs.some((s) => PROTECTED_SEGMENTS.has(s))) return true;
  return PROTECTED_BASENAMES.has(segs[segs.length - 1]!);
}

function filePathOf(tool: AutoApprovalTool, input: Record<string, unknown>): unknown {
  return tool === 'NotebookEdit' ? input.notebook_path : input.file_path;
}

function truncate(s: string): string {
  return s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX - 1)}…` : s;
}

export interface RuleMatch {
  rule: AutoApprovalRule;
  tool: AutoApprovalTool;
  summary: string;
}

/**
 * The first rule that allows this tool call, or null. `folderReal` must already
 * be the realpath of the session folder. `toolName` must equal a rule's tool
 * exactly (case-sensitive: `bash` is not `Bash`).
 */
export function matchRules(
  rules: readonly AutoApprovalRule[],
  folderReal: string,
  toolName: unknown,
  toolInput: unknown,
): RuleMatch | null {
  if (!isAutoApprovalTool(toolName)) return null;
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) return null;
  const input = toolInput as Record<string, unknown>;
  const candidates = rules.filter((r) => r.tool === toolName);
  if (candidates.length === 0) return null;

  if (AUTO_APPROVAL_TOOLS[toolName] === 'command') {
    // A sandbox escape is always the user's call.
    if (input.dangerouslyDisableSandbox) return null;
    const command = input.command;
    const rule = candidates.find((r) => typeof r.bashPrefix === 'string' && matchBashPrefix(r.bashPrefix, command));
    return rule ? { rule, tool: toolName, summary: truncate(normalizeCommand(command as string)) } : null;
  }

  const rel = relativeInside(folderReal, filePathOf(toolName, input));
  if (rel === null) return null;
  if (WRITE_TOOLS.has(toolName) && isProtected(rel)) return null;
  const rule = candidates.find((r) => globToRegExp(r.pathGlob ?? '**').test(rel));
  return rule ? { rule, tool: toolName, summary: truncate(rel) } : null;
}

export type RuleInputResult =
  | { ok: true; tool: AutoApprovalTool; bashPrefix?: string; pathGlob?: string }
  | { ok: false; error: string };

/** Validate a rule as typed by the user (also re-run on every rule loaded from disk). */
export function validateRuleInput(raw: { tool?: unknown; bashPrefix?: unknown; pathGlob?: unknown }): RuleInputResult {
  if (!isAutoApprovalTool(raw.tool)) {
    return { ok: false, error: `tool must be one of ${Object.keys(AUTO_APPROVAL_TOOLS).join(', ')}` };
  }
  const tool = raw.tool;
  if (AUTO_APPROVAL_TOOLS[tool] === 'command') {
    if (raw.pathGlob !== undefined) return { ok: false, error: 'pathGlob applies to file tools only' };
    if (typeof raw.bashPrefix !== 'string') return { ok: false, error: 'Bash rules need a command prefix' };
    const prefix = normalizeCommand(raw.bashPrefix);
    if (!prefix) return { ok: false, error: 'Bash rules need a command prefix' };
    if (prefix.length > MAX_PREFIX) return { ok: false, error: `prefix is longer than ${MAX_PREFIX} characters` };
    if (!isPlainCommand(prefix)) {
      return { ok: false, error: 'prefix may not contain shell operators ( ; & | ` $ < > \\ ( ) { } ) or non-ASCII characters' };
    }
    return { ok: true, tool, bashPrefix: prefix };
  }
  if (raw.bashPrefix !== undefined) return { ok: false, error: 'bashPrefix applies to Bash only' };
  if (raw.pathGlob === undefined || raw.pathGlob === '') return { ok: true, tool, pathGlob: '**' };
  if (typeof raw.pathGlob !== 'string') return { ok: false, error: 'pathGlob must be a string' };
  const glob = raw.pathGlob.trim();
  if (!glob || glob.length > MAX_GLOB) return { ok: false, error: `pathGlob must be 1-${MAX_GLOB} characters` };
  if (glob.startsWith('/') || glob.startsWith('~')) return { ok: false, error: 'pathGlob is relative to the session folder' };
  if (glob.split('/').some((s) => s === '..' || s === '.')) return { ok: false, error: 'pathGlob may not contain . or .. segments' };
  if (/[\\[\]{}!]/.test(glob) || NON_PRINTABLE_ASCII.test(glob)) {
    return { ok: false, error: 'pathGlob supports only *, ** and ? wildcards' };
  }
  return { ok: true, tool, pathGlob: glob };
}

/** The exact stdout JSON for a PreToolUse "allow" (hooks reference, PreToolUse decision control). */
export function allowHookOutput(ruleId: string): {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse';
    permissionDecision: 'allow';
    permissionDecisionReason: string;
  };
} {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: `Auto-approved by Argus rule ${ruleId}`,
    },
  };
}
