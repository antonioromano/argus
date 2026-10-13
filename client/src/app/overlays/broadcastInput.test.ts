import { describe, it, expect } from 'vitest';
import type { SessionInfo } from '@argus/shared';
import { broadcastTargets, broadcastTextError } from './broadcastInput.js';

const s = (id: string, status: SessionInfo['status']): SessionInfo => ({ id, name: id, folderPath: '/r', status, createdAt: '', agentType: 'claude', flags: [] });

describe('broadcastInput', () => {
  it('targets every session with a live agent', () => {
    expect(broadcastTargets([s('a', 'idle'), s('b', 'exited'), s('c', 'waiting')]).map((x) => x.id)).toEqual(['a', 'c']);
  });

  it('explains what the server would refuse', () => {
    expect(broadcastTextError('/compact', true)).toBeNull();
    expect(broadcastTextError('', true)).toBeNull();
    expect(broadcastTextError('', false)).toMatch(/Type something/);
    expect(broadcastTextError('a\nb', true)).toMatch(/One line/);
    expect(broadcastTextError('\x1b[2J', true)).toMatch(/One line/);
    expect(broadcastTextError('x'.repeat(4001), true)).toMatch(/4000/);
  });
});
