/**
 * Claude Code conversation ids, as reported in every hook's `session_id`.
 *
 * The id ends up in the agent's argv (`claude --resume <id>`) and from there in
 * a shell command line, so only the canonical UUID shape is ever accepted —
 * never a value that could carry a flag, a space or a shell metacharacter.
 */
export const CLAUDE_SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isClaudeSessionId(v: unknown): v is string {
  return typeof v === 'string' && CLAUDE_SESSION_ID_RE.test(v);
}
