import { describe, it, expect } from 'vitest';
import type { SessionStatus } from '@argus/shared';
import { TIPS, nextTip, tipById, type TipContext } from './tips.js';
import { EMPTY_DISCOVERY, markUsed } from './discoveryState.js';

const s = (id: string, status: SessionStatus = 'idle', folderPath = '/repo') => ({ id, status, folderPath });
const fires = (id: string, ctx: TipContext) => tipById(id)!.fires(ctx);

describe('tip triggers', () => {
  it('waiting-inbox: 3 waiting yes, 2 no', () => {
    expect(fires('waiting-inbox', { sessions: [s('a', 'waiting'), s('b', 'waiting'), s('c')] })).toBe(false);
    expect(fires('waiting-inbox', { sessions: [s('a', 'waiting'), s('b', 'waiting'), s('c', 'waiting')] })).toBe(true);
  });

  it('worktrees: a non-worktree create in a repo folder already in use', () => {
    const create = { type: 'create' as const, gitRepo: true, worktree: false, folderPath: '/repo' };
    expect(fires('worktrees', { sessions: [s('a'), s('b')], lastEvent: create })).toBe(true);
    expect(fires('worktrees', { sessions: [s('a'), s('b', 'idle', '/other')], lastEvent: create }), 'different folder').toBe(false);
    expect(fires('worktrees', { sessions: [s('a'), s('b')], lastEvent: { ...create, worktree: true } }), 'already a worktree').toBe(false);
    expect(fires('worktrees', { sessions: [s('a'), s('b')], lastEvent: { ...create, gitRepo: false } }), 'not a repo').toBe(false);
    expect(fires('worktrees', { sessions: [s('a'), s('b')] }), 'no event').toBe(false);
  });

  it('broadcast: 2 live sessions yes, 1 no', () => {
    expect(fires('broadcast', { sessions: [s('a')] })).toBe(false);
    expect(fires('broadcast', { sessions: [s('a'), s('b')] })).toBe(true);
  });

  it('session-search: only on a deep scroll', () => {
    expect(fires('session-search', { sessions: [] })).toBe(false);
    expect(fires('session-search', { sessions: [], lastEvent: { type: 'deep-scroll', sessionId: 'a' } })).toBe(true);
  });
});

describe('nextTip', () => {
  const busy: TipContext = { sessions: [s('a', 'waiting'), s('b', 'waiting'), s('c', 'waiting')] };

  it('picks in catalogue order (inbox before broadcast)', () => {
    expect(nextTip(TIPS, busy, EMPTY_DISCOVERY)?.id).toBe('waiting-inbox');
  });

  it('skips a tip already shown', () => {
    expect(nextTip(TIPS, busy, { ...EMPTY_DISCOVERY, tipsSeen: ['waiting-inbox'] })?.id).toBe('broadcast');
  });

  it('never teaches a feature already used', () => {
    const used = markUsed(markUsed(EMPTY_DISCOVERY, 'inbox'), 'broadcast');
    expect(nextTip(TIPS, busy, used)).toBeNull();
  });
});
