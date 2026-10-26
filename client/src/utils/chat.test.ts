import { describe, it, expect } from 'vitest';
import type { ChatMessage } from '@argus/shared';
import { EMPTY_CHAT, MAX_CLIENT_CHAT_MESSAGES, applyChatUpdate, modelLabel, permissionModeLabel, slashQuery, slashSuggestions, supportsChatView } from './chat.js';

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

  it('drops echoes the transcript caught up with', () => {
    const s0 = applyChatUpdate(EMPTY_CHAT, { reset: true, available: true, messages: [msg('a'), msg('echo-1')] });
    const s1 = applyChatUpdate(s0, { reset: false, available: true, messages: [msg('c')], removed: ['echo-1'] });
    expect(s1.messages.map((m) => m.id)).toEqual(['a', 'c']);
    // A removal alone (nothing new) still changes the list.
    const s2 = applyChatUpdate(s0, { reset: false, available: true, messages: [], removed: ['echo-1'] });
    expect(s2.messages.map((m) => m.id)).toEqual(['a']);
    expect(applyChatUpdate(s2, { reset: false, available: true, messages: [], removed: ['gone'] }).messages).toBe(s2.messages);
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

  it('keeps the /model pick across appends', () => {
    const s0 = applyChatUpdate(EMPTY_CHAT, { reset: true, available: true, messages: [], modelSet: 'Sonnet 5.5' });
    const s1 = applyChatUpdate(s0, { reset: false, available: true, messages: [msg('a')] });
    expect(s1.modelSet).toBe('Sonnet 5.5');
    expect(applyChatUpdate(s1, { reset: false, available: true, messages: [], modelSet: 'Opus 5.5' }).modelSet).toBe('Opus 5.5');
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

describe('slash autocomplete', () => {
  const custom = [
    { name: 'pr-review', description: 'Review a PR' },
    { name: 'anthropic-skills:pdf', description: 'PDFs' },
    { name: 'init', description: 'duplicate of a built-in' },
  ];

  it('ranks prefix matches first, then plugin-suffix and substring matches', () => {
    expect(slashSuggestions('re', custom).map((c) => c.name).slice(0, 4)).toEqual(['resume', 'review', 'rewind', 'pr-review']);
    expect(slashSuggestions('pdf', custom).map((c) => c.name)).toEqual(['anthropic-skills:pdf']);
    expect(slashSuggestions('', custom).filter((c) => c.name === 'init')).toEqual([{ name: 'init', description: 'Create a CLAUDE.md for this project' }]);
    expect(slashSuggestions('zzz', custom)).toEqual([]);
    // An exact name beats a longer one listed earlier.
    expect(slashSuggestions('deploy', [{ name: 'deploy-staging' }, { name: 'deploy' }]).map((c) => c.name)).toEqual(['deploy', 'deploy-staging']);
  });

  it('only opens for a single /token at the start with the caret at its end', () => {
    expect(slashQuery('/mo', 3)).toBe('mo');
    expect(slashQuery('/', 1)).toBe('');
    expect(slashQuery('/model opus', 11)).toBeNull();
    expect(slashQuery('hi /mo', 6)).toBeNull();
    expect(slashQuery('/mo', 1)).toBeNull();
  });

  it('commands come with a reset and survive appends', () => {
    const s0 = applyChatUpdate(EMPTY_CHAT, { reset: true, available: true, messages: [], commands: custom });
    const s1 = applyChatUpdate(s0, { reset: false, available: true, messages: [msg('a')] });
    expect(s1.commands).toBe(custom);
  });
});
