import { describe, it, expect } from 'vitest';
import type { ChatMessage } from '@argus/shared';
import { showTypingRow } from './typingRow.js';

const prompt: ChatMessage = { id: 'u', role: 'user', blocks: [{ kind: 'text', text: 'hi' }] };
const tools = (...statuses: Array<'ok' | 'pending' | 'error' | 'blocked'>): ChatMessage => ({
  id: 'a',
  role: 'assistant',
  blocks: statuses.map((status, i) => ({ kind: 'tool' as const, id: `t${i}`, name: 'Bash', label: 'x', status })),
});

describe('showTypingRow', () => {
  it('shows after a prompt while running with no agents', () => expect(showTypingRow('running', 0, prompt)).toBe(true));
  it('shows after a settled tool group', () => expect(showTypingRow('running', 0, tools('ok', 'error'))).toBe(true));
  it('hides while a tool step is pending', () => expect(showTypingRow('running', 0, tools('ok', 'pending'))).toBe(false));
  it('hides while an agent runs', () => expect(showTypingRow('running', 1, prompt)).toBe(false));
  it('hides after a text reply', () => {
    expect(showTypingRow('running', 0, { id: 'a', role: 'assistant', blocks: [{ kind: 'text', text: 'done' }] })).toBe(false);
  });
  it.each(['waiting', 'idle', 'done', 'exited'] as const)('hides when %s', (s) => expect(showTypingRow(s, 0, prompt)).toBe(false));
  it('hides with no rows', () => expect(showTypingRow('running', 0, undefined)).toBe(false));
});
