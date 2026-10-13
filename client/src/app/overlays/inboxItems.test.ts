import { describe, it, expect } from 'vitest';
import type { SessionInfo } from '@argus/shared';
import { formatWaiting, optionForKey, waitingItems } from './inboxItems.js';

const s = (id: string, over: Partial<SessionInfo> = {}): SessionInfo => ({
  id, name: id, folderPath: `/r/${id}`, status: 'waiting', createdAt: '', agentType: 'claude', flags: [], ...over,
});

describe('waitingInbox helpers', () => {
  it('keeps only waiting sessions, longest-waiting first, unknown start last', () => {
    const list = [s('a', { waitingSince: 300 }), s('b', { status: 'running' }), s('c'), s('d', { waitingSince: 100 })];
    expect(waitingItems(list).map((x) => x.id)).toEqual(['d', 'a', 'c']);
  });

  it('formats waiting time', () => {
    expect(formatWaiting(8_000)).toBe('8s');
    expect(formatWaiting(125_000)).toBe('2m');
    expect(formatWaiting(3_900_000)).toBe('1h 5m');
    expect(formatWaiting(-5)).toBe('0s');
  });

  it('maps a digit to an option only when the menu was read', () => {
    const withMenu = s('a', { promptOptions: [{ key: '1', label: 'Yes' }, { key: '2', label: 'No' }] });
    expect(optionForKey(withMenu, '2')).toBe('2');
    expect(optionForKey(withMenu, '3')).toBeUndefined();
    expect(optionForKey(s('b'), '1')).toBeUndefined();
  });
});
