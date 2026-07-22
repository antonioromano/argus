import type { AgentSignalAdapter } from './types.js';
import { ClaudeHooksAdapter } from './ClaudeHooksAdapter.js';

const claude = new ClaudeHooksAdapter();

/**
 * Resolve the native-signal adapter for an agent, or null if the agent has no
 * native channel (→ heuristic-only). Gemini (hooks) and Codex (notify) adapters
 * land in Units 5 and 4; custom-agent opt-in via AgentDefinition.stateSignals is
 * a later extension.
 */
export function getSignalAdapter(agentType: string): AgentSignalAdapter | null {
  switch (agentType) {
    case 'claude':
      return claude;
    default:
      return null;
  }
}
