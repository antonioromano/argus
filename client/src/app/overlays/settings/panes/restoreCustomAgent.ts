import type { AppConfig } from '@argus/shared';

type AgentSlices = Pick<AppConfig, 'customAgents' | 'agentFlags' | 'defaultAgent'>;

/**
 * The patch that puts custom agent `id` back after it was removed from
 * `before`, merged into `current` so edits made since survive: the agent goes
 * back at its old index, its saved flags come back, and it becomes the default
 * again only if it was the default and nobody picked another one since (the
 * remove fell back to 'claude').
 */
export function restoreCustomAgentPatch(current: AgentSlices, before: AgentSlices, id: string): Partial<AppConfig> {
  const index = before.customAgents.findIndex((a) => a.id === id);
  const agent = before.customAgents[index];
  if (!agent) return {};
  const patch: Partial<AppConfig> = {};
  if (!current.customAgents.some((a) => a.id === id)) {
    const agents = [...current.customAgents];
    agents.splice(Math.min(index, agents.length), 0, agent);
    patch.customAgents = agents;
  }
  if (before.agentFlags[id] && !current.agentFlags[id]) {
    patch.agentFlags = { ...current.agentFlags, [id]: before.agentFlags[id] };
  }
  if (before.defaultAgent === id && current.defaultAgent === 'claude') patch.defaultAgent = id;
  return patch;
}
