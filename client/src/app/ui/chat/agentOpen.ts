import { createContext } from 'react';
import type { AgentRun } from '@argus/shared';

/** What an Agent tool step needs to offer "Open": its roster entry, and how to open it. */
export interface AgentOpener {
  /** The roster agent an Agent call launched, by the call's `tool_use` id. */
  agentFor: (toolUseId: string) => AgentRun | undefined;
  open: (agent: AgentRun) => void;
}

/** Provided by the Chat view when its host can open an agent; steps read it past the memoized rows. */
export const AgentOpenContext = createContext<AgentOpener | null>(null);

/** Tool names that launch an agent (`Task` is Claude Code's older name for `Agent`). */
export const AGENT_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task']);
