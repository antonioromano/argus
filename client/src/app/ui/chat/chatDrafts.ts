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

/** A draft as stored: text and saved paths (thumbnails and pending uploads don't outlive the window). */
interface StoredDraft {
  text: string;
  attachments: { path: string; name: string }[];
}

function toStored(d: ChatDraft | undefined): StoredDraft | undefined {
  if (!d) return undefined;
  const attachments = d.attachments.flatMap((a) => (a.path && !a.failed ? [{ path: a.path, name: a.name }] : []));
  return d.text || attachments.length > 0 ? { text: d.text, attachments } : undefined;
}

function fromStored(raw: unknown): ChatDraft | undefined {
  const d = raw as Partial<{ text: unknown; attachments: unknown }> | null;
  const text = typeof d?.text === 'string' ? d.text : '';
  const attachments = (Array.isArray(d?.attachments) ? d.attachments : [])
    .filter((a): a is { path: string; name: string } => typeof a?.path === 'string' && typeof a?.name === 'string')
    .map((a) => ({ key: newAttachmentKey(), path: a.path, name: a.name }));
  const draft = { text, attachments };
  return isEmpty(draft) ? undefined : draft;
}

function readStored(): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(CHAT_DRAFTS_KEY) ?? 'null');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const sameStored = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function load(): void {
  if (loaded) return;
  loaded = true;
  for (const [id, raw] of Object.entries(readStored())) {
    const draft = fromStored(raw);
    if (draft) drafts.set(id, draft);
  }
  // Every window shares the key: take in what another window wrote.
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
}

/** Another window changed the stored drafts; adopt the sessions whose stored draft differs from ours. */
function onStorage(e: StorageEvent): void {
  if (e.key !== CHAT_DRAFTS_KEY && e.key !== null) return;
  const stored = readStored();
  let changed = false;
  for (const id of new Set([...drafts.keys(), ...Object.keys(stored)])) {
    const mine = drafts.get(id);
    if (sameStored(toStored(mine), stored[id])) continue;
    if (mine) revokePreviews(mine.attachments);
    const theirs = fromStored(stored[id]);
    if (theirs) drafts.set(id, theirs);
    else drafts.delete(id);
    changed = true;
  }
  if (changed) notify();
}

/**
 * Write the given sessions' drafts to localStorage. Read-modify-write: other
 * windows' drafts in the same key are left as they are.
 */
function persist(ids: Iterable<string>): void {
  const stored = readStored();
  for (const id of ids) {
    const d = toStored(drafts.get(id));
    if (d) stored[id] = d;
    else delete stored[id];
  }
  try {
    if (Object.keys(stored).length === 0) localStorage.removeItem(CHAT_DRAFTS_KEY);
    else localStorage.setItem(CHAT_DRAFTS_KEY, JSON.stringify(stored));
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
  persist([sessionId]);
  notify();
}

/** Drop the drafts of sessions that no longer exist. */
export function pruneChatDrafts(liveSessionIds: ReadonlySet<string>): void {
  load();
  const gone = [...drafts.keys()].filter((id) => !liveSessionIds.has(id));
  for (const id of gone) {
    revokePreviews(drafts.get(id)!.attachments);
    drafts.delete(id);
  }
  // Also what other windows stored for sessions that are gone.
  const stale = Object.keys(readStored()).filter((id) => !liveSessionIds.has(id));
  if (gone.length === 0 && stale.length === 0) return;
  persist([...gone, ...stale]);
  if (gone.length > 0) notify();
}

/** Forget everything in memory and re-read localStorage on next use (tests). */
export function resetChatDraftsForTest(): void {
  drafts.clear();
  loaded = false;
  if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
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
