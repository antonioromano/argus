import { describe, it, expect, vi } from 'vitest';
import type { SessionInfo } from '@argus/shared';
import { sessionSource } from './session.js';
import { stubContext } from './testContext.js';

const s = { id: 's1', name: 'api', folderPath: '/r/api', status: 'idle', createdAt: '', agentType: 'claude', flags: [], worktreePath: '/w', worktreeBranch: 'b' } as SessionInfo;
const base = { onOpen: vi.fn(), onKill: vi.fn(), onRestart: vi.fn() };

describe('sessionSource', () => {
  it('returns nothing with no focused session', () => {
    expect(sessionSource(stubContext())).toEqual([]);
  });

  it('maps the ⋯ menu to session:<id> rows, destructive from danger, menu twins aliased', () => {
    const cmds = sessionSource(stubContext({ focusedSession: s, sessionMenuActions: base }));
    const close = cmds.find((c) => c.id === 'session:close')!;
    expect(close.destructive).toBe(true);
    expect(close.aliases).toEqual(['shortcut:close-shell']);
    expect(close.hint).toBe('api');
    close.run();
    expect(base.onKill).toHaveBeenCalledWith(s);
  });

  it('routes Rename to the inline editor', () => {
    const beginRename = vi.fn();
    sessionSource(stubContext({ focusedSession: s, sessionMenuActions: base, beginRename }))
      .find((c) => c.id === 'session:rename')!.run();
    expect(beginRename).toHaveBeenCalledWith('s1');
  });

  it('drops Finish while its beta handler is absent', () => {
    const off = sessionSource(stubContext({ focusedSession: s, sessionMenuActions: { ...base, canFinish: () => true } }));
    expect(off.some((c) => c.id === 'session:finish')).toBe(false);
    const on = sessionSource(stubContext({ focusedSession: s, sessionMenuActions: { ...base, onFinish: vi.fn(), canFinish: () => true } }));
    expect(on.some((c) => c.id === 'session:finish')).toBe(true);
  });
});
