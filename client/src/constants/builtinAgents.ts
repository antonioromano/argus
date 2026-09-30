import type { AgentDefinition } from '@argus/shared';

/** The agents Argus ships with. Mirrors the server's AgentRegistry built-ins —
 *  the renderer needs them before any config round-trip, since config.customAgents
 *  holds only the user's additions. */
export const BUILTIN_AGENTS: AgentDefinition[] = [
  { id: 'claude', name: 'Claude Code', command: 'claude', builtin: true },
  { id: 'gemini', name: 'Gemini', command: 'gemini', builtin: true },
  { id: 'codex', name: 'Codex', command: 'codex', builtin: true },
];
