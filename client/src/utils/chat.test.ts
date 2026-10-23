import { describe, it, expect } from 'vitest';
import type { ChatMessage } from '@argus/shared';
import { EMPTY_CHAT, MAX_CLIENT_CHAT_MESSAGES, applyChatUpdate, chatInputBytes, modelLabel, permissionModeLabel, supportsChatView } from './chat.js';

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

describe('permission mode', () => {
  it('comes with a reset and survives appends that do not carry it', () => {
    const s0 = applyChatUpdate(EMPTY_CHAT, { reset: true, available: true, messages: [], permissionMode: 'auto' });
    const s1 = applyChatUpdate(s0, { reset: false, available: true, messages: [msg('a')] });
    expect(s1.permissionMode).toBe('auto');
    const s2 = applyChatUpdate(s1, { reset: false, available: true, messages: [], permissionMode: 'plan' });
    expect(s2.permissionMode).toBe('plan');
    expect(s2.messages).toBe(s1.messages);
  });

  it('has readable labels, unknown modes as written', () => {
    expect(permissionModeLabel('auto')).toBe('Auto');
    expect(permissionModeLabel('default')).toBe('Manual');
    expect(permissionModeLabel('acceptEdits')).toBe('Accept edits');
    expect(permissionModeLabel('futureMode')).toBe('futureMode');
  });
});

describe('modelLabel', () => {
  it('turns model ids into names', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5');
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(modelLabel('claude-fable-5-1')).toBe('Fable 5.1');
    expect(modelLabel('mystery')).toBe('mystery');
  });
});
