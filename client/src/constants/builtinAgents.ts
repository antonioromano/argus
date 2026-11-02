import { SHELL_AGENT_ID, type AgentDefinition } from '@argus/shared';

/** The agents Argus ships with. Mirrors the server's AgentRegistry built-ins —
 *  the renderer needs them before any config round-trip, since config.customAgents
 *  holds only the user's additions. `installCommand` is what the "couldn't find"
 *  exited card copies; Claude Code's is the native installer from
 *  https://code.claude.com/docs/en/setup (the npm package is the alternative). */
export const BUILTIN_AGENTS: AgentDefinition[] = [
  { id: 'claude', name: 'Claude Code', command: 'claude', builtin: true, installCommand: 'curl -fsSL https://claude.ai/install.sh | bash' },
  { id: 'gemini', name: 'Gemini', command: 'gemini', builtin: true, installCommand: 'npm install -g @google/gemini-cli' },
  { id: 'codex', name: 'Codex', command: 'codex', builtin: true, installCommand: 'npm install -g @openai/codex' },
  // No AI attached — the user's login shell (the server resolves $SHELL).
  { id: SHELL_AGENT_ID, name: 'Shell', command: '$SHELL', builtin: true },
];

/** The definition behind a session's agentType: built-ins first, then the
 *  user's custom agents. Returns the array element itself, so the result is
 *  referentially stable for memoized consumers. */
export function resolveAgentDef(agentType: string, customAgents?: AgentDefinition[]): AgentDefinition | undefined {
  return BUILTIN_AGENTS.find((a) => a.id === agentType) ?? customAgents?.find((a) => a.id === agentType);
}
