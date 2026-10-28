import { describe, it, expect } from 'vitest';
import type { ChatMessage } from '@argus/shared';
import { keyOf, lastUserId, openPending, type Pending } from './pendingEchoes.js';

const u = (id: string, text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, role: 'user', blocks: [{ kind: 'text', text }], ...extra });
const a = (id: string): ChatMessage => ({ id, role: 'assistant', blocks: [{ kind: 'text', text: 'ok' }] });
const p = (id: string, key: string, after: string | null, extra: Partial<Pending> = {}): Pending => ({
  id,
  blocks: key ? [{ kind: 'text', text: key }] : [{ kind: 'image' }],
  key,
  queued: true,
  after,
  ...extra,
});
const ids = (list: Pending[]) => list.map((x) => x.id);

describe('keyOf', () => {
  it('is the typed text, whitespace collapsed', () => {
    expect(keyOf('fix  the\nbug', [{ kind: 'text', text: 'fix  the\nbug' }])).toBe('fix the bug');
    // Attachment paths come first in the sent text; the preview starts with the typed text.
    expect(keyOf('/tmp/a.png\nlook', [{ kind: 'text', text: 'look' }, { kind: 'image' }])).toBe('look');
  });
  it('is empty when only attachments were sent', () => {
    expect(keyOf('/repo/notes.md', [{ kind: 'text', text: '`notes.md`' }])).toBe('');
    expect(keyOf('/tmp/a.png', [{ kind: 'image' }])).toBe('');
  });
});

describe('openPending', () => {
  const history = [u('u0', 'start'), a('a0')];

  it('keeps a prompt until a user message with its text is recorded after it was sent', () => {
    const list = [p('p1', 'next step', 'u0')];
    expect(ids(openPending(list, history))).toEqual(['p1']);
    // An assistant reply or another prompt's text does not settle it.
    expect(ids(openPending(list, [...history, a('a1'), u('u1', 'something else')]))).toEqual(['p1']);
    expect(openPending(list, [...history, u('u1', 'next  step')])).toEqual([]);
  });

  it('returns the same array when nothing settled (no state churn)', () => {
    const list = [p('p1', 'x', 'u0')];
    expect(openPending(list, history)).toBe(list);
  });

  it('ignores a matching message recorded before the prompt was sent', () => {
    const msgs = [u('u0', 'again'), a('a0')];
    expect(ids(openPending([p('p1', 'again', 'u0')], msgs))).toEqual(['p1']);
  });

  it('settles several queued prompts in send order, each exactly once', () => {
    const list = [p('p1', 'ok', 'u0'), p('p2', 'ok', 'u0'), p('p3', 'then this', 'u0')];
    expect(ids(openPending(list, [...history, u('u1', 'ok')]))).toEqual(['p2', 'p3']);
    expect(ids(openPending(list, [...history, u('u1', 'ok'), u('u2', 'ok')]))).toEqual(['p3']);
    expect(openPending(list, [...history, u('u1', 'ok'), u('u2', 'ok'), u('u3', 'then this')])).toEqual([]);
  });

  it('a settled prompt keeps its claim after it is pruned', () => {
    const msgs = [...history, u('u1', 'ok')];
    const open = openPending([p('p1', 'ok', 'u0'), p('p2', 'two', 'u0'), p('p3', 'ok', 'u0')], msgs);
    expect(ids(open)).toEqual(['p2', 'p3']);
    expect(ids(openPending(open, msgs))).toEqual(['p2', 'p3']);
  });

  it('a later prompt never settles from a message recorded before an earlier one', () => {
    // p2's text was recorded first (typed in the terminal); p1 then p2 still need their own.
    const list = [p('p1', 'first', 'u0'), p('p2', 'second', 'u0')];
    expect(ids(openPending(list, [...history, u('u1', 'second'), u('u2', 'first')]))).toEqual(['p2']);
  });

  it('matches the typed text after attachment paths, and prompts merged into one entry', () => {
    expect(openPending([p('p1', 'look', 'u0')], [...history, u('u1', '/repo/shot.png look')])).toEqual([]);
    const list = [p('p1', 'one', 'u0'), p('p2', 'two', 'u0')];
    expect(openPending(list, [...history, u('u1', 'one\ntwo')])).toEqual([]);
    // Whole words only.
    expect(ids(openPending([p('p1', 'go', 'u0')], [...history, u('u1', 'good')]))).toEqual(['p1']);
  });

  it('settles an attachment-only prompt by order', () => {
    expect(openPending([p('p1', '', 'u0')], [...history, u('u1', '/tmp/x.png')])).toEqual([]);
  });

  it('skips server echoes of slash commands', () => {
    expect(ids(openPending([p('p1', '', 'u0')], [...history, u('echo-1', '/cost', { echo: true })]))).toEqual(['p1']);
  });

  it('drops a stopped or discarded prompt once the conversation moves past it, not before', () => {
    const stopped = p('p1', 'never read', 'u0', { stopped: true, markedAfter: 'u0' });
    const discarded = p('p2', 'dropped', 'u0', { discarded: true, markedAfter: 'u0' });
    expect(ids(openPending([stopped, discarded], [...history, a('a1')]))).toEqual(['p1', 'p2']);
    expect(openPending([stopped, discarded], [...history, u('u1', 'new prompt')])).toEqual([]);
    // Recorded late after all: settled like any other.
    expect(ids(openPending([discarded], [...history, u('u1', 'dropped')]))).toEqual([]);
  });
});

it('lastUserId skips echoes and assistant messages', () => {
  expect(lastUserId([u('u0', 'x'), u('echo-1', '/cost', { echo: true }), a('a0')])).toBe('u0');
  expect(lastUserId([a('a0')])).toBeNull();
});
