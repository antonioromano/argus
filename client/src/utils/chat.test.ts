import { describe, it, expect } from 'vitest';
import type { ChatMessage } from '@argus/shared';
import { EMPTY_CHAT, MAX_CLIENT_CHAT_MESSAGES, applyChatUpdate, chatInputBytes, supportsChatView } from './chat.js';

const msg = (id: string, role: ChatMessage['role'] = 'user'): ChatMessage => ({ id, role, blocks: [{ kind: 'text', text: id }] });

describe('applyChatUpdate', () => {
  it('a reset replaces the list and marks it loaded', () => {
    const s = applyChatUpdate({ loaded: true, available: true, messages: [msg('old')] }, { reset: true, available: true, messages: [msg('a'), msg('b')] });
    expect(s).toEqual({ loaded: true, available: true, messages: [msg('a'), msg('b')] });
  });

  it('an append adds only unseen ids', () => {
    const s0 = applyChatUpdate(EMPTY_CHAT, { reset: true, available: true, messages: [msg('a')] });
    const s1 = applyChatUpdate(s0, { reset: false, available: true, messages: [msg('a'), msg('b')] });
    expect(s1.messages.map((m) => m.id)).toEqual(['a', 'b']);
    expect(applyChatUpdate(s1, { reset: false, available: true, messages: [msg('b')] })).toBe(s1);
  });

  it('an unavailable reset clears the list', () => {
    const s = applyChatUpdate({ loaded: true, available: true, messages: [msg('a')] }, { reset: true, available: false, messages: [] });
    expect(s).toEqual({ loaded: true, available: false, messages: [] });
  });

  it('keeps only the newest messages', () => {
    const many = Array.from({ length: MAX_CLIENT_CHAT_MESSAGES + 3 }, (_, i) => msg(`m${i}`));
    const s = applyChatUpdate(EMPTY_CHAT, { reset: true, available: true, messages: many });
    expect(s.messages).toHaveLength(MAX_CLIENT_CHAT_MESSAGES);
    expect(s.messages[0].id).toBe('m3');
  });
});

describe('chatInputBytes', () => {
  it('sends a single line as typed', () => {
    expect(chatInputBytes('hello')).toBe('hello');
  });

  it('sends multi-line text as a bracketed paste with LF newlines', () => {
    expect(chatInputBytes('a\r\nb\rc')).toBe('\x1b[200~a\nb\nc\x1b[201~');
  });
});

describe('supportsChatView', () => {
  it('is Claude only', () => {
    expect(supportsChatView('claude')).toBe(true);
    expect(supportsChatView('codex')).toBe(false);
    expect(supportsChatView('gemini')).toBe(false);
  });
});
