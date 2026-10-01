import { execFileSync } from 'child_process';
import type { AgentDefinition, AgentStatus } from '@argus/shared';
import { SHELL_AGENT_ID } from '../constants/agents.js';

const BUILTIN_AGENTS: AgentDefinition[] = [
  {
    id: 'claude',
    name: 'Claude',
    command: 'claude',
    builtin: true,
    installCommand: 'npm install -g @anthropic-ai/claude-code',
    installUrl: 'https://docs.anthropic.com/en/docs/claude-code',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    builtin: true,
    installCommand: 'npm install -g @google/gemini-cli',
    installUrl: 'https://github.com/google-gemini/gemini-cli',
  },
  {
    id: 'codex',
    name: 'Codex',
    command: 'codex',
    builtin: true,
    installCommand: 'npm install -g @openai/codex',
    installUrl: 'https://github.com/openai/codex',
  },
  {
    // No AI: the user's own login shell, same binary the ⌘T terminal uses.
    id: SHELL_AGENT_ID,
    name: 'Shell',
    command: process.env.SHELL || '/bin/zsh',
    builtin: true,
  },
];

export class AgentRegistry {
  getBuiltins(): AgentDefinition[] {
    return BUILTIN_AGENTS;
  }

  getAll(customAgents: AgentDefinition[]): AgentDefinition[] {
    return [...BUILTIN_AGENTS, ...customAgents];
  }

  getById(id: string, customAgents: AgentDefinition[]): AgentDefinition | undefined {
    return this.getAll(customAgents).find((a) => a.id === id);
  }

  isRegistered(id: string, customAgents: AgentDefinition[]): boolean {
    return this.getById(id, customAgents) !== undefined;
  }

  /** AI agents only — the plain shell is always available and has nothing to install. */
  detectInstalled(): AgentStatus[] {
    return BUILTIN_AGENTS.filter((a) => a.id !== SHELL_AGENT_ID).map((agent) => {
      try {
        const resolvedPath = execFileSync('which', [agent.command], { encoding: 'utf-8' }).trim();
        return { agent, installed: true, resolvedPath };
      } catch {
        return { agent, installed: false };
      }
    });
  }
}

/**
 * argv that carries an initial prompt for this agent, appended after every other
 * flag (and after Argus's signal injection). null = the agent can't take one.
 * Forms verified against each CLI's --help (2026-09-30): claude `[prompt]` positional
 * starts an interactive session; codex `[PROMPT]` positional is interactive (exec is
 * a separate subcommand); gemini `-i, --prompt-interactive`.
 */
export function promptArgs(agent: AgentDefinition, prompt: string): string[] | null {
  if (agent.builtin) {
    if (agent.id === 'claude' || agent.id === 'codex') return [prompt];
    if (agent.id === 'gemini') return ['-i', prompt];
    return null;
  }
  return agent.promptFlag ? [agent.promptFlag, prompt] : null;
}
