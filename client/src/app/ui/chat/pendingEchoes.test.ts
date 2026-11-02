import { describe, it, expect } from 'vitest';
import type { ChatMessage } from '@argus/shared';
import { newPending, openPending, userCountOf, type Pending } from './pendingEchoes.js';

const text = (t: string) => [{ kind: 'text' as const, text: t }];
const queue = (seq: number, n = 0) => ({ items: Array.from({ length: n }, (_, i) => ({ id: `queued-${seq - n + i + 1}`, blocks: text('q') })), seq });

describe('userCountOf', () => {
  it("counts recorded user messages, not assistant ones or the server's command echoes", () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', blocks: text('a') },
      { id: 'a1', role: 'assistant', blocks: text('b') },
      { id: 'echo-1', role: 'user', blocks: [{ kind: 'command', name: '/cost' }], echo: true },
      { id: 'u2', role: 'user', blocks: text('c') },
    ];
    expect(userCountOf(messages)).toBe(2);
  });
});

describe('newPending', () => {
  it('sent at the prompt: shown until the next user message is recorded', () => {
    expect(newPending('p1', text('hi'), [], 3, 0, undefined, false)).toEqual({ id: 'p1', blocks: text('hi'), at: 4 });
  });

  it('every prompt still shown, queued or pending, is recorded before it', () => {
    const cur = [newPending('p1', text('a'), [], 3, 0, undefined, false)];
    expect(newPending('p2', text('b'), cur, 3, 2, queue(2, 2), false).at).toBe(7);
  });

  it("sent while running: also shown until Claude Code's queue lists one more prompt than before", () => {
    const first = newPending('p1', text('a'), [], 1, 1, queue(5, 1), true);
    expect(first).toEqual({ id: 'p1', blocks: text('a'), at: 3, queueAt: 6 });
    // Sent before Claude Code queued the first: the one after it.
    expect(newPending('p2', text('b'), [first], 1, 1, queue(5, 1), true).queueAt).toBe(7);
  });
});

describe('openPending', () => {
  const p = (id: string, at: number, queueAt?: number): Pending => ({ id, blocks: text(id), at, ...(queueAt === undefined ? {} : { queueAt }) });

  it('keeps a prompt until the transcript holds its user message', () => {
    const pending = [p('a', 2), p('b', 3)];
    expect(openPending(pending, 1, 0)).toBe(pending);
    expect(openPending(pending, 2, 0).map((x) => x.id)).toEqual(['b']);
    expect(openPending(pending, 3, 0)).toEqual([]);
  });

  it("hands a queued prompt over to Claude Code's queue once it lists it", () => {
    const pending = [p('a', 2, 1), p('b', 3, 2)];
    expect(openPending(pending, 1, 0)).toBe(pending);
    expect(openPending(pending, 1, 1).map((x) => x.id)).toEqual(['b']);
    expect(openPending(pending, 1, 2)).toEqual([]);
  });

  it('a queued prompt Claude Code recorded without queueing it (it was idle by then) drops out too', () => {
    expect(openPending([p('a', 2, 1)], 2, 0)).toEqual([]);
  });

  it('returns the same array when nothing dropped out (no state churn)', () => {
    const pending = [p('a', 5)];
    expect(openPending(pending, 1, 0)).toBe(pending);
    const none: Pending[] = [];
    expect(openPending(none, 9, 9)).toBe(none);
  });
});
