import { describe, it, expect } from 'vitest';
import type { AgentDefinition, AppConfig } from '@argus/shared';
import { restoreCustomAgentPatch } from './restoreCustomAgent.js';

const agent = (id: string): AgentDefinition => ({ id, name: id.toUpperCase(), command: id, builtin: false });
type Slices = Pick<AppConfig, 'customAgents' | 'agentFlags' | 'defaultAgent'>;

const before: Slices = {
  customAgents: [agent('a'), agent('b'), agent('c')],
  agentFlags: { b: [{ id: 'f', value: '--fast', enabled: true }] },
  defaultAgent: 'b',
};
// What the remove wrote.
const afterRemove: Slices = { customAgents: [agent('a'), agent('c')], agentFlags: {}, defaultAgent: 'claude' };

describe('restoreCustomAgentPatch', () => {
  it('puts the agent back at its index with its flags and default', () => {
    expect(restoreCustomAgentPatch(afterRemove, before, 'b')).toEqual({
      customAgents: [agent('a'), agent('b'), agent('c')],
      agentFlags: { b: before.agentFlags.b },
      defaultAgent: 'b',
    });
  });

  it('keeps edits made since: a newer agent, other flags, a newly chosen default', () => {
    const current: Slices = {
      customAgents: [agent('a'), agent('c'), agent('d')],
      agentFlags: { d: [{ id: 'g', value: '--x', enabled: false }] },
      defaultAgent: 'gemini',
    };
    const patch = restoreCustomAgentPatch(current, before, 'b');
    expect(patch.customAgents?.map((a) => a.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(patch.agentFlags).toEqual({ d: current.agentFlags.d, b: before.agentFlags.b });
    expect('defaultAgent' in patch).toBe(false);
  });

  it('is a no-op when the agent is already back', () => {
    expect(restoreCustomAgentPatch(before, before, 'b')).toEqual({});
  });
});
