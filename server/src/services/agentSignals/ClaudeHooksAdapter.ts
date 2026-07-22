import path from 'path';
import { readFileSync as fsReadFileSync } from 'fs';
import type { AgentSignalState } from '@argus/shared';
import type { AgentSignalAdapter, SignalInjection, SignalInjectionContext } from './types.js';

interface ClaudeHookCommand {
  type: 'command';
  command: string;
}
interface ClaudeHookEntry {
  matcher?: string;
  hooks: ClaudeHookCommand[];
}
type ClaudeHooks = Record<string, ClaudeHookEntry[]>;
interface ClaudeSettings {
  hooks?: ClaudeHooks;
  [key: string]: unknown;
}

/**
 * Pull a `--settings` value out of a flag list (both `--settings <v>` and
 * `--settings=<v>` forms), returning the value and the remaining flags with that
 * flag removed. Only the first occurrence matters — Claude's repeated-flag
 * behavior is last-wins, so the last one would have been the effective one; we
 * merge whichever we find and collapse to a single flag either way.
 */
export function extractSettingsFlag(flags: string[]): { value?: string; rest: string[] } {
  const rest: string[] = [];
  let value: string | undefined;
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i]!;
    if (f === '--settings') {
      value = flags[i + 1];
      i++; // skip the value too
      continue;
    }
    if (f.startsWith('--settings=')) {
      value = f.slice('--settings='.length);
      continue;
    }
    rest.push(f);
  }
  return { value, rest };
}

/**
 * Merge Argus's hook entries into a user's Claude settings (Q1). Hook arrays
 * concatenate per event (Claude runs all matching hooks), Argus entries appended
 * after the user's so user hooks still fire; every other user key is preserved
 * untouched. Returns a new object.
 */
export function mergeClaudeSettings(user: ClaudeSettings, argusHooks: ClaudeHooks): ClaudeSettings {
  const merged: ClaudeSettings = { ...user, hooks: { ...(user.hooks ?? {}) } };
  const hooks = merged.hooks as ClaudeHooks;
  for (const [event, entries] of Object.entries(argusHooks)) {
    hooks[event] = [...(hooks[event] ?? []), ...entries];
  }
  return merged;
}

/** Parse a user --settings value that is either inline JSON or a file path. */
function loadUserSettings(
  value: string,
  readFileSync: (p: string) => string,
): ClaudeSettings | null {
  const trimmed = value.trim();
  // Inline JSON (Claude accepts a JSON string directly).
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed) as ClaudeSettings;
    } catch {
      return null;
    }
  }
  // Otherwise a path.
  try {
    return JSON.parse(readFileSync(trimmed)) as ClaudeSettings;
  } catch {
    return null;
  }
}

/**
 * Claude Code adapter: injects Stop→idle, UserPromptSubmit/PreToolUse→running,
 * Notification→waiting(+prompt) hooks via a generated `--settings` file. When the
 * user already passes their own `--settings`, deep-merges into it and collapses
 * to a single flag (Q1) — never clobbering user hooks, never relying on Claude's
 * undocumented last-wins.
 */
export class ClaudeHooksAdapter implements AgentSignalAdapter {
  readonly coverage: readonly AgentSignalState[] = ['running', 'waiting', 'idle'];

  /** Injectable for tests; defaults to fs.readFileSync utf8. */
  constructor(private readFileSync: (p: string) => string = defaultRead) {}

  private argusHooks(ctx: SignalInjectionContext): ClaudeHooks {
    const bin = ctx.signalBinPath;
    const base = `"${bin}" --session ${ctx.sessionId} --state`;
    const cmd = (rest: string): ClaudeHookEntry => ({
      hooks: [{ type: 'command', command: `${base} ${rest}` }],
    });
    return {
      Stop: [cmd('idle')],
      UserPromptSubmit: [cmd('running')],
      PreToolUse: [cmd('running')],
      Notification: [cmd('waiting --prompt-from-stdin')],
    };
  }

  inject(ctx: SignalInjectionContext): SignalInjection {
    const argusHooks = this.argusHooks(ctx);
    const settingsPath = path.join(ctx.signalDir, `${ctx.sessionId}.json`);
    const { value: userSettingsFlag, rest } = extractSettingsFlag(ctx.userFlags);

    let content: ClaudeSettings = { hooks: argusHooks };
    if (userSettingsFlag !== undefined) {
      const user = loadUserSettings(userSettingsFlag, this.readFileSync);
      if (user) {
        content = mergeClaudeSettings(user, argusHooks);
      } else {
        // Couldn't read/parse the user's settings — merging would risk dropping
        // their hooks, so fall back to heuristics for this session rather than
        // clobber. Return the user's flags untouched and inject nothing.
        console.warn(
          `[agentSignals] could not read user --settings for session ${ctx.sessionId}; ` +
            'skipping native Claude hooks (heuristic detection only)',
        );
        return { flags: ctx.userFlags, env: {}, files: [] };
      }
    }

    return {
      flags: [...rest, '--settings', settingsPath],
      env: {},
      files: [{ path: settingsPath, content: JSON.stringify(content, null, 2) }],
    };
  }
}

function defaultRead(p: string): string {
  return fsReadFileSync(p, 'utf8');
}
