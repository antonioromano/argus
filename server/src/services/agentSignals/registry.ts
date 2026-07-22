import type { AgentSignalAdapter } from './types.js';
import { ClaudeHooksAdapter } from './ClaudeHooksAdapter.js';
import { GeminiHooksAdapter } from './GeminiHooksAdapter.js';
import { CodexNotifyAdapter } from './CodexNotifyAdapter.js';

const claude = new ClaudeHooksAdapter();
const gemini = new GeminiHooksAdapter();
const codex = new CodexNotifyAdapter();

/**
 * Resolve the native-signal adapter for an agent, or null if the agent has no
 * native channel (→ heuristic-only). Custom-agent opt-in via
 * AgentDefinition.stateSignals is a later extension.
 */
export function getSignalAdapter(agentType: string): AgentSignalAdapter | null {
  switch (agentType) {
    case 'claude':
      return claude;
    case 'gemini':
      return gemini;
    case 'codex':
      return codex;
    default:
      return null;
  }
}
