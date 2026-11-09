import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AgentRun, ChatMessage, SessionInfo } from '@argus/shared';
import { ChatAgentSheet } from './ChatAgentSheet.js';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../services/api.js', () => ({ api: { getAgentChat: mocks.get, getImageBlob: vi.fn() } }));

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

const agent = (over: Partial<AgentRun> = {}): AgentRun => ({
  id: 'a1', toolUseId: 'toolu_1', agentType: 'pre-push-reviewer', description: 'Delta review of fix commit', background: false,
  depth: 1, startedAt: 1, status: 'running', outputTokens: 10, ...over,
});
const session = (over: Partial<SessionInfo> = {}): SessionInfo => ({
  id: 's1', name: 'api', folderPath: '/repo', status: 'running', createdAt: new Date().toISOString(),
  agentType: 'claude', flags: [], ...over,
});
const messages: ChatMessage[] = [
  { id: 'u1', role: 'user', blocks: [{ kind: 'text', text: 'Review the delta' }] },
  { id: 'm1', role: 'assistant', blocks: [
    { kind: 'text', text: 'Reading the handler' },
    { kind: 'tool', id: 'tu1', name: 'Read', label: 'handler.ts', status: 'ok' },
  ] },
];

let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  mocks.get.mockReset();
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const render = async (props: Partial<Parameters<typeof ChatAgentSheet>[0]> = {}) => {
  const onClose = vi.fn();
  await act(async () => {
    root.render(<ChatAgentSheet session={session()} agent={agent()} onClose={onClose} {...props} />);
  });
  return { onClose };
};
const sheet = () => document.querySelector<HTMLElement>('[data-testid="agent-sheet"]')!;

describe('ChatAgentSheet', () => {
  it('title is the description, subtitle the type', async () => {
    mocks.get.mockResolvedValue({ available: true, messages, offset: 10 });
    await render();
    expect(sheet().textContent).toContain('Delta review of fix commit');
    expect(sheet().textContent).toContain('pre-push-reviewer');
    expect(sheet().textContent).toContain('Running');
  });

  it('renders messages and tool steps', async () => {
    mocks.get.mockResolvedValue({ available: true, messages, offset: 10 });
    await render();
    expect(sheet().textContent).toContain('Review the delta');
    expect(sheet().textContent).toContain('Reading the handler');
    expect(sheet().querySelector('[data-testid="chat-tool-step"]')?.textContent).toContain('handler.ts');
  });

  it('no composer', async () => {
    mocks.get.mockResolvedValue({ available: true, messages, offset: 10 });
    await render();
    expect(sheet().querySelector('textarea')).toBeNull();
    expect(sheet().querySelector('[contenteditable]')).toBeNull();
  });

  it('shows a loading state while the first read runs', async () => {
    mocks.get.mockReturnValue(new Promise(() => {}));
    await render();
    expect(sheet().textContent).toContain('Reading');
  });

  it('says so while the agent has no transcript', async () => {
    mocks.get.mockResolvedValue({ available: false, messages: [], offset: 0 });
    await render();
    expect(sheet().textContent).toContain('No transcript yet');
  });

  it('error state goes through describeError', async () => {
    mocks.get.mockRejectedValue(new TypeError('Failed to fetch'));
    await render();
    // An ErrorState with the described headline, never the raw message as the text.
    expect(sheet().textContent).toContain('ERROR');
    expect(sheet().querySelector('.argus-error-cause')).not.toBeNull();
    const details = sheet().querySelector('.argus-error-details');
    expect(details?.textContent).toContain('Failed to fetch');
  });

  it('lists the agents it launched under the header', async () => {
    mocks.get.mockResolvedValue({ available: true, messages, offset: 10 });
    const child = agent({ id: 'c1', depth: 2, parentAgentId: 'a1', agentType: 'Explore', description: 'Find callers' });
    const other = agent({ id: 'c2', depth: 2, parentAgentId: 'zz', agentType: 'Explore', description: 'Not mine' });
    await render({ session: session({ agents: [agent(), child, other] }) });
    const nested = sheet().querySelector('[data-testid="agent-sheet-nested"]');
    expect(nested?.textContent).toContain('Find callers');
    expect(nested?.textContent).not.toContain('Not mine');
  });

  it('closes from its close button', async () => {
    mocks.get.mockResolvedValue({ available: true, messages, offset: 10 });
    const { onClose } = await render();
    act(() => sheet().querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
    expect(onClose).toHaveBeenCalled();
  });

  it('full screen: a fixed screen with a Back button', async () => {
    mocks.get.mockResolvedValue({ available: true, messages, offset: 10 });
    const { onClose } = await render({ fullScreen: true });
    expect(sheet().style.position).toBe('fixed');
    expect(sheet().textContent).toContain('Delta review of fix commit');
    act(() => sheet().querySelector<HTMLButtonElement>('button[aria-label="Back"]')!.click());
    expect(onClose).toHaveBeenCalled();
  });
});
