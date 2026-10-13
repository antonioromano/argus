import { describe, it, expect } from 'vitest';
import type { SessionInfo } from '@argus/shared';
import { canResume } from './resume.js';

const s = (over: Partial<SessionInfo>): SessionInfo => ({
  id: 'a', name: 'a', folderPath: '/a', status: 'exited', createdAt: '', agentType: 'claude', flags: [],
  claudeSessionId: '0b0e7a3c-1f2d-4e5f-8a9b-0c1d2e3f4a5b', ...over,
});

describe('canResume', () => {
  it('needs an exited Claude session with a conversation id', () => {
    expect(canResume(s({}))).toBe(true);
    expect(canResume(s({ status: 'idle' }))).toBe(false);
    expect(canResume(s({ agentType: 'gemini' }))).toBe(false);
    expect(canResume(s({ claudeSessionId: undefined }))).toBe(false);
  });
});
