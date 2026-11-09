import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AgentChatResponse, AgentRun, ChatMessage } from '@argus/shared';
import { useAgentChat } from './useAgentChat.js';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../services/api.js', () => ({ api: { getAgentChat: mocks.get } }));

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

const agent = (over: Partial<AgentRun> = {}): AgentRun => ({
  id: 'a1', toolUseId: 'toolu_1', agentType: 'general-purpose', description: 'Find the bug', background: false,
  depth: 1, startedAt: 1, status: 'running', outputTokens: 10, ...over,
});
const text = (id: string, t: string): ChatMessage => ({ id, role: 'assistant', blocks: [{ kind: 'text', text: t }] });
const pendingTool = (id: string): ChatMessage => ({
  id, role: 'assistant', blocks: [{ kind: 'tool', id: 'tu', name: 'Read', label: 'a.ts', status: 'pending' }],
});
const page = (messages: ChatMessage[], offset: number, available = true): AgentChatResponse => ({ available, messages, offset });

const latest: { v: ReturnType<typeof useAgentChat> | null } = { v: null };
function Probe({ a }: { a: AgentRun | null }) {
  const v = useAgentChat('s1', a);
  useEffect(() => { latest.v = v; });
  return null;
}

let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  latest.v = null;
  mocks.get.mockReset();
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const show = async (a: AgentRun | null) => { await act(async () => { root.render(<Probe a={a} />); }); };

describe('useAgentChat', () => {
  it('first reads from byte 0 and is loading until then', async () => {
    let resolve!: (r: AgentChatResponse) => void;
    mocks.get.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    await show(agent());
    expect(mocks.get).toHaveBeenCalledWith('s1', 'a1', 0);
    expect(latest.v!.loading).toBe(true);
    await act(async () => { resolve(page([text('m1', 'hi')], 100)); });
    expect(latest.v!.loading).toBe(false);
    expect(latest.v!.messages.map((m) => m.id)).toEqual(['m1']);
  });

  it('appends by id from the returned offset on the next roster change', async () => {
    mocks.get.mockResolvedValueOnce(page([text('m1', 'hi')], 100));
    await show(agent());
    mocks.get.mockResolvedValueOnce(page([text('m1', 'hi again'), text('m2', 'more')], 180));
    await show(agent({ outputTokens: 20 }));
    expect(mocks.get).toHaveBeenLastCalledWith('s1', 'a1', 100);
    expect(latest.v!.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(latest.v!.messages[0].blocks[0]).toEqual({ kind: 'text', text: 'hi again' });
  });

  it('refetches from 0 while a tool step is still pending', async () => {
    mocks.get.mockResolvedValueOnce(page([pendingTool('m1')], 100));
    await show(agent());
    mocks.get.mockResolvedValueOnce(page([text('m1', 'done')], 150));
    await show(agent({ lastStep: { name: 'Read', label: 'a.ts', status: 'ok' } }));
    expect(mocks.get).toHaveBeenLastCalledWith('s1', 'a1', 0);
    expect(latest.v!.messages).toEqual([text('m1', 'done')]);
  });

  it('fetches once more when the agent stops, then never again', async () => {
    mocks.get.mockResolvedValue(page([], 100));
    await show(agent());
    await show(agent({ status: 'finished', outputTokens: 30 }));
    expect(mocks.get).toHaveBeenCalledTimes(2);
    await show(agent({ status: 'finished', outputTokens: 40 }));
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it('a finished agent is read once', async () => {
    mocks.get.mockResolvedValue(page([text('m1', 'hi')], 100));
    await show(agent({ status: 'finished' }));
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(latest.v!.messages).toHaveLength(1);
  });

  it('reports a failed read as the error', async () => {
    const err = new Error('boom');
    mocks.get.mockRejectedValueOnce(err);
    await show(agent());
    expect(latest.v!.error).toBe(err);
    expect(latest.v!.loading).toBe(false);
  });

  it('starts over for another agent and ignores the old one\'s late reply', async () => {
    let resolve!: (r: AgentChatResponse) => void;
    mocks.get.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    await show(agent());
    mocks.get.mockResolvedValueOnce(page([text('b1', 'other')], 50));
    await show(agent({ id: 'a2' }));
    expect(mocks.get).toHaveBeenLastCalledWith('s1', 'a2', 0);
    await act(async () => { resolve(page([text('m1', 'stale')], 100)); });
    expect(latest.v!.messages.map((m) => m.id)).toEqual(['b1']);
  });

  it('reads nothing without an agent', async () => {
    await show(null);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(latest.v!.messages).toEqual([]);
  });
});
