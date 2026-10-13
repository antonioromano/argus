/**
 * Runtime markers a Claude Code session exports to its children. When Argus
 * (or `npm run dev`) is started from inside a Claude Code terminal it inherits
 * them, and so does every agent it spawns: an inherited CLAUDE_CODE_CHILD_SESSION
 * makes Claude treat the session as a child and switch transcript saving off —
 * which blanks the usage meter and leaves nothing to resume — and the parent's
 * messaging socket/token would reach every agent. They describe the PARENT
 * session, never one Argus starts, so drop them once at startup; everything
 * spawned later (argusd, tmux, agents) inherits the clean env. User settings
 * (CLAUDE_CODE_ENABLE_TELEMETRY etc.) are left alone, and agents start in a
 * login shell that re-reads the user's rc files anyway.
 */
export const PARENT_AGENT_ENV_KEYS = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SSE_PORT',
  'CLAUDE_PID',
] as const;

/** Removes the parent-session markers from `env` in place; returns what was removed. */
export function scrubParentAgentEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const removed: string[] = [];
  for (const key of PARENT_AGENT_ENV_KEYS) {
    if (key in env) {
      delete env[key];
      removed.push(key);
    }
  }
  return removed;
}
