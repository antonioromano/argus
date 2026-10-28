import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CHAT_DRAFTS_KEY, getChatDraft, pruneChatDrafts, resetChatDraftsForTest, updateChatDraft } from './chatDrafts.js';

beforeEach(() => {
  localStorage.clear();
  resetChatDraftsForTest();
  URL.revokeObjectURL = vi.fn();
});

/** A window reload: memory is gone, localStorage stays. */
const reload = () => resetChatDraftsForTest();

describe('chatDrafts', () => {
  it('survives a reload through localStorage, keeping only saved paths', () => {
    updateChatDraft('s1', () => ({
      text: 'draft',
      attachments: [
        { key: 'a', path: '/Users/me/a.png', name: 'a.png', preview: 'blob:a' },
        { key: 'b', name: 'Pasted image', preview: 'blob:b' },
        { key: 'c', path: '/x', name: 'x', failed: true },
      ],
    }));
    reload();
    const d = getChatDraft('s1');
    expect(d.text).toBe('draft');
    expect(d.attachments).toEqual([{ key: expect.any(String), path: '/Users/me/a.png', name: 'a.png' }]);
  });

  it('removes the stored entry once a draft is empty', () => {
    updateChatDraft('s1', () => ({ text: 'x', attachments: [] }));
    updateChatDraft('s1', () => ({ text: '', attachments: [] }));
    expect(localStorage.getItem(CHAT_DRAFTS_KEY)).toBeNull();
    expect(getChatDraft('s1')).toEqual({ text: '', attachments: [] });
  });

  it('drops the drafts of sessions that no longer exist', () => {
    updateChatDraft('live', () => ({ text: 'keep', attachments: [] }));
    updateChatDraft('gone', () => ({ text: 'drop', attachments: [{ key: 'k', path: '/p', name: 'p', preview: 'blob:p' }] }));
    pruneChatDrafts(new Set(['live']));
    expect(getChatDraft('gone').text).toBe('');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:p');
    reload();
    expect(getChatDraft('live').text).toBe('keep');
    expect(getChatDraft('gone').text).toBe('');
  });

  it('ignores unreadable storage', () => {
    localStorage.setItem(CHAT_DRAFTS_KEY, '{not json');
    expect(getChatDraft('s1')).toEqual({ text: '', attachments: [] });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    updateChatDraft('s1', () => ({ text: 'still here', attachments: [] }));
    expect(getChatDraft('s1').text).toBe('still here');
    setItem.mockRestore();
  });

  it("leaves other windows' drafts in storage alone", () => {
    getChatDraft('mine'); // this window loaded an empty store
    // Another window (same localStorage) saves its own session's draft.
    localStorage.setItem(CHAT_DRAFTS_KEY, JSON.stringify({ theirs: { text: 'from B', attachments: [] } }));
    updateChatDraft('mine', () => ({ text: 'from A', attachments: [] }));
    const stored = JSON.parse(localStorage.getItem(CHAT_DRAFTS_KEY)!);
    expect(stored.theirs.text).toBe('from B');
    expect(stored.mine.text).toBe('from A');
    // Pruning sees what other windows stored too.
    pruneChatDrafts(new Set(['mine']));
    expect(JSON.parse(localStorage.getItem(CHAT_DRAFTS_KEY)!)).toEqual({ mine: { text: 'from A', attachments: [] } });
  });

  it('takes in what another window wrote, keeping its own pending uploads', () => {
    updateChatDraft('s1', () => ({ text: 'old', attachments: [] }));
    updateChatDraft('s2', () => ({ text: 'mine', attachments: [{ key: 'u', name: 'Pasted image', preview: 'blob:u' }] }));
    localStorage.setItem(
      CHAT_DRAFTS_KEY,
      JSON.stringify({ s1: { text: 'newer from B', attachments: [] }, s2: { text: 'mine', attachments: [] } }),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: CHAT_DRAFTS_KEY }));
    expect(getChatDraft('s1').text).toBe('newer from B');
    expect(getChatDraft('s2').attachments).toHaveLength(1);
  });
});
