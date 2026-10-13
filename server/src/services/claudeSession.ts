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

/** Flags that pick which conversation Claude opens. A resume replaces them all. */
const CONVERSATION_FLAGS_WITH_VALUE = new Set(['--resume', '-r', '--session-id']);
const CONVERSATION_FLAGS_BARE = new Set(['--continue', '-c']);

/**
 * argv for `claude --resume <id>` on top of the session's own flags.
 *
 * The id is re-validated here, at the point it enters argv, regardless of where
 * it came from. Any conversation-selecting flag the user stored (`--continue`,
 * an older `--resume x`, `--session-id x`) is dropped so it cannot fight the
 * resume. `--resume` goes first so a variadic user flag (`--mcp-config a b`)
 * can never swallow the id as one of its values.
 */
export function buildResumeFlags(userFlags: readonly string[], claudeSessionId: string): string[] {
  if (!isClaudeSessionId(claudeSessionId)) throw new Error('Invalid Claude session id');
  const rest: string[] = [];
  for (let i = 0; i < userFlags.length; i++) {
    const f = userFlags[i]!;
    if (CONVERSATION_FLAGS_BARE.has(f)) continue;
    if (CONVERSATION_FLAGS_WITH_VALUE.has(f)) {
      // `--resume` alone opens a picker; only skip a following value, never a flag.
      const next = userFlags[i + 1];
      if (next !== undefined && !next.startsWith('-')) i++;
      continue;
    }
    if (/^(?:--resume|--session-id)=/.test(f)) continue;
    rest.push(f);
  }
  return ['--resume', claudeSessionId, ...rest];
}
