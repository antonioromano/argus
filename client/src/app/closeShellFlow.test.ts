import { describe, it, expect, vi } from 'vitest';
import type { SessionInfo } from '@argus/shared';
import { canReopen, closeShellMode, closeThenOfferReopen, groupSlotOf, reopenRequest } from './closeShellFlow.js';

const CONVO = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('closeShellMode', () => {
  it.each([
    ['exited', true, 'defer'],
    ['exited', false, 'defer'],
    ['running', true, 'confirm'],
    ['waiting', true, 'confirm'],
    ['idle', false, 'immediate'],
    ['running', false, 'immediate'],
  ] as const)('%s with confirm %s → %s', (status, confirm, mode) => {
    expect(closeShellMode({ status }, confirm)).toBe(mode);
  });
});

describe('canReopen', () => {
  it('only a Claude session with a conversation, outside a worktree', () => {
    expect(canReopen({ agentType: 'claude', claudeSessionId: CONVO })).toBe(true);
    expect(canReopen({ agentType: 'claude' })).toBe(false);
    expect(canReopen({ agentType: 'gemini', claudeSessionId: CONVO })).toBe(false);
    expect(canReopen({ agentType: 'claude', claudeSessionId: CONVO, worktreePath: '/wt' })).toBe(false);
  });
});

describe('reopenRequest', () => {
  it('replays folder, name, agent, flags, engine and run mode with the resume id', () => {
    const s = {
      id: 's1', name: 'api', folderPath: '/repo', agentType: 'claude', flags: ['--model=opus'],
      terminalEngine: 'native', runMode: 'direct', claudeSessionId: CONVO, status: 'running', createdAt: '',
    } as unknown as SessionInfo;
    expect(reopenRequest(s)).toEqual({
      folderPath: '/repo', name: 'api', agentType: 'claude', flags: ['--model=opus'],
      terminalEngine: 'native', runMode: 'direct', resumeClaudeSessionId: CONVO,
    });
  });
});

describe('groupSlotOf', () => {
  const groups = [
    { id: 'fav', sessionIds: ['a'] },
    { id: 'g1', sessionIds: ['x', 'a', 'y'] },
    { id: 'g2', sessionIds: ['z'] },
  ];
  it('finds the group and the member below it, skipping reserved groups', () => {
    expect(groupSlotOf(groups, 'a', new Set(['fav']))).toEqual({ groupId: 'g1', beforeId: 'y' });
  });
  it('last in its group → beforeId null; ungrouped → null', () => {
    expect(groupSlotOf(groups, 'z')).toEqual({ groupId: 'g2', beforeId: null });
    expect(groupSlotOf(groups, 'nope')).toBeNull();
  });
});

describe('closeThenOfferReopen', () => {
  const claude = { agentType: 'claude', claudeSessionId: CONVO, worktreePath: undefined } as const;

  it('offers Reopen once the kill has landed', async () => {
    const offer = vi.fn();
    await closeThenOfferReopen(claude, async () => true, offer);
    expect(offer).toHaveBeenCalledOnce();
  });

  it('offers nothing when the kill failed: the agent is still running', async () => {
    const offer = vi.fn();
    await closeThenOfferReopen(claude, async () => false, offer);
    expect(offer).not.toHaveBeenCalled();
  });

  it('waits for the kill before offering', async () => {
    const offer = vi.fn();
    let land!: (ok: boolean) => void;
    const done = closeThenOfferReopen(claude, () => new Promise<boolean>((r) => { land = r; }), offer);
    await Promise.resolve();
    expect(offer).not.toHaveBeenCalled();
    land(true);
    await done;
    expect(offer).toHaveBeenCalledOnce();
  });

  it('offers nothing for a session that cannot come back', async () => {
    const offer = vi.fn();
    await closeThenOfferReopen({ ...claude, agentType: 'codex' }, async () => true, offer);
    expect(offer).not.toHaveBeenCalled();
  });
});
