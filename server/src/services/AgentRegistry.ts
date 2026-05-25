import { execFileSync } from 'child_process';
import type { AgentDefinition, AgentStatus } from '@argus/shared';

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

  detectInstalled(): AgentStatus[] {
    return BUILTIN_AGENTS.map((agent) => {
      try {
        const resolvedPath = execFileSync('which', [agent.command], { encoding: 'utf-8' }).trim();
        return { agent, installed: true, resolvedPath };
      } catch {
        return { agent, installed: false };
      }
    });
  }
}
