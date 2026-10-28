import { useCallback, useSyncExternalStore } from 'react';

/** A file attached in the Chat composer. */
export interface DraftAttachment {
  key: string;
  /** Absolute path sent to Claude; undefined while a pasted image uploads. */
  path?: string;
  name: string;
  /** blob: URL of an image, for the thumbnail. */
  preview?: string;
  /** The upload failed: shown as an error, never sent. */
  failed?: boolean;
}

/** The composer's unsent message: what was typed and what was attached. */
export interface ChatDraft {
  text: string;
  attachments: DraftAttachment[];
}

/** localStorage key of the drafts, so they survive a window reload. */
export const CHAT_DRAFTS_KEY = 'argus-chat-drafts';

const EMPTY: ChatDraft = { text: '', attachments: [] };

/**
 * Unsent drafts by session id (F11). They live here, not in the composer, so
 * switching a session to the terminal, to another session or between focus and
 * mosaic (each unmounts the composer) keeps what was typed. Only sending clears
 * a draft; a deleted session's is dropped by pruneChatDrafts.
 */
const drafts = new Map<string, ChatDraft>();
const listeners = new Set<() => void>();
let loaded = false;
let nextKey = 0;

export const newAttachmentKey = () => `att-${++nextKey}`;

const isEmpty = (d: ChatDraft) => d.text === '' && d.attachments.length === 0;
export const revokePreviews = (list: DraftAttachment[]) => list.forEach((a) => a.preview && URL.revokeObjectURL(a.preview));

function load(): void {
  if (loaded) return;
  loaded = true;
  let raw: unknown;
  try {
    raw = JSON.parse(localStorage.getItem(CHAT_DRAFTS_KEY) ?? 'null');
  } catch {
    return;
  }
  if (!raw || typeof raw !== 'object') return;
  for (const [id, d] of Object.entries(raw as Record<string, Partial<{ text: unknown; attachments: unknown }>>)) {
    const text = typeof d?.text === 'string' ? d.text : '';
    const attachments = (Array.isArray(d?.attachments) ? d.attachments : [])
      .filter((a): a is { path: string; name: string } => typeof a?.path === 'string' && typeof a?.name === 'string')
      .map((a) => ({ key: newAttachmentKey(), path: a.path, name: a.name }));
    const draft = { text, attachments };
    if (!isEmpty(draft)) drafts.set(id, draft);
  }
}

/**
 * Write the drafts to localStorage. Thumbnails (blob: URLs) and uploads that
 * have no path yet don't outlive the window, so only saved paths are kept.
 */
function persist(): void {
  const out: Record<string, { text: string; attachments: { path: string; name: string }[] }> = {};
  for (const [id, d] of drafts) {
    const attachments = d.attachments.flatMap((a) => (a.path && !a.failed ? [{ path: a.path, name: a.name }] : []));
    if (d.text || attachments.length > 0) out[id] = { text: d.text, attachments };
  }
  try {
    if (Object.keys(out).length === 0) localStorage.removeItem(CHAT_DRAFTS_KEY);
    else localStorage.setItem(CHAT_DRAFTS_KEY, JSON.stringify(out));
  } catch {
    // Storage full or unavailable: the in-memory draft still survives view switches.
  }
}

const notify = () => listeners.forEach((l) => l());

export function getChatDraft(sessionId: string): ChatDraft {
  load();
  return drafts.get(sessionId) ?? EMPTY;
}

/** Replace a session's draft with `fn` of the current one (also after its composer unmounted). */
export function updateChatDraft(sessionId: string, fn: (d: ChatDraft) => ChatDraft): void {
  const cur = getChatDraft(sessionId);
  const next = fn(cur);
  if (next === cur) return;
  if (isEmpty(next)) drafts.delete(sessionId);
  else drafts.set(sessionId, next);
  persist();
  notify();
}

/** Drop the drafts of sessions that no longer exist. */
export function pruneChatDrafts(liveSessionIds: ReadonlySet<string>): void {
  load();
  let changed = false;
  for (const [id, d] of drafts) {
    if (liveSessionIds.has(id)) continue;
    revokePreviews(d.attachments);
    drafts.delete(id);
    changed = true;
  }
  if (!changed) return;
  persist();
  notify();
}

/** Forget everything in memory and re-read localStorage on next use (tests). */
export function resetChatDraftsForTest(): void {
  drafts.clear();
  loaded = false;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** A session's draft, and an updater that keeps it in the store. */
export function useChatDraft(sessionId: string): [ChatDraft, (fn: (d: ChatDraft) => ChatDraft) => void] {
  const draft = useSyncExternalStore(subscribe, () => getChatDraft(sessionId));
  const update = useCallback((fn: (d: ChatDraft) => ChatDraft) => updateChatDraft(sessionId, fn), [sessionId]);
  return [draft, update];
}
