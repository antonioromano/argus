import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ChatMessage, ChatUpdate, SessionInfo } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import { ChatView } from './ChatView.js';
import { CHAT_ENTER_DELAY_MS } from '../../../utils/chat.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

type Fn = (payload: unknown) => void;

function fakeSocket() {
  const handlers = new Map<string, Set<Fn>>();
  const emitted: Array<[string, unknown]> = [];
  const socket = {
    connected: true,
    on: (ev: string, fn: Fn) => { if (!handlers.has(ev)) handlers.set(ev, new Set()); handlers.get(ev)!.add(fn); },
    off: (ev: string, fn: Fn) => { handlers.get(ev)?.delete(fn); },
    emit: (ev: string, payload: unknown) => { emitted.push([ev, payload]); },
  };
  const fire = (ev: string, payload: unknown) => act(() => handlers.get(ev)?.forEach((f) => f(payload)));
  return { socket: socket as unknown as Socket<any, any>, emitted, fire }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const session = (over: Partial<SessionInfo> = {}): SessionInfo => ({
  id: 's1',
  name: 'chat test',
  folderPath: '/repo',
  status: 'idle',
  createdAt: new Date().toISOString(),
  agentType: 'claude',
  flags: [],
  ...over,
});

const update = (over: Partial<ChatUpdate>): ChatUpdate => ({ sessionId: 's1', reset: true, available: true, messages: [], ...over });

let container: HTMLDivElement;
let root: Root;

function render(s: SessionInfo, socket: Socket<any, any>, onSend = vi.fn(), onShowTerminal = vi.fn()) { // eslint-disable-line @typescript-eslint/no-explicit-any
  act(() => {
    root.render(
      <ChatView session={s} socket={socket} onSend={onSend} onShowTerminal={onShowTerminal} />,
    );
  });
  return { onSend, onShowTerminal };
}

// jsdom has no layout; the virtualizer sizes its viewport from offsetWidth/Height.
const realOffset = {
  width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth'),
  height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'),
};

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 4000 });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { root = createRoot(container); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  vi.useRealTimers();
  if (realOffset.width) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', realOffset.width);
  if (realOffset.height) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realOffset.height);
});

describe('ChatView', () => {
  it('subscribes on mount and unsubscribes on unmount', () => {
    const { socket, emitted } = fakeSocket();
    render(session(), socket);
    expect(emitted).toContainEqual(['session:chat:subscribe', 's1']);
    act(() => root.render(<></>));
    expect(emitted).toContainEqual(['session:chat:unsubscribe', 's1']);
  });

  it('falls back to the terminal while no transcript is readable', () => {
    const { socket, fire } = fakeSocket();
    const { onShowTerminal } = render(session(), socket);
    expect(container.textContent).toContain('Reading transcript');
    fire('session:chat', update({ available: false }));
    expect(container.textContent).toContain('Chat not available yet');
    const back = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Back to terminal'));
    act(() => back!.click());
    expect(onShowTerminal).toHaveBeenCalledTimes(1);
  });

  it('renders user and assistant messages with markdown, code blocks and tool chips', () => {
    const { socket, fire } = fakeSocket();
    render(session(), socket);
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', blocks: [{ kind: 'text', text: 'Fix the **bug**' }] },
      {
        id: 'a1',
        role: 'assistant',
        blocks: [
          { kind: 'text', text: '## Plan\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```' },
          { kind: 'tool', name: 'Bash' },
          { kind: 'unknown', type: 'hologram' },
        ],
      },
    ];
    fire('session:chat', update({ messages }));
    const roles = Array.from(container.querySelectorAll('.argus-chat-msg')).map((el) => el.getAttribute('data-role'));
    expect(roles).toEqual(['user', 'assistant']);
    expect(container.querySelector('strong')?.textContent).toBe('bug');
    expect(container.querySelector('h2')?.textContent).toBe('Plan');
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelector('.argus-chat-code-lang')?.textContent).toBe('ts');
    expect(container.querySelector('.argus-chat-code code')?.textContent).toBe('const x = 1;');
    expect(container.textContent).toContain('Bash');
    expect(container.textContent).toContain('hologram');
  });

  it('appends new messages and ignores other sessions', () => {
    const { socket, fire } = fakeSocket();
    render(session(), socket);
    fire('session:chat', update({ messages: [{ id: 'u1', role: 'user', blocks: [{ kind: 'text', text: 'one' }] }] }));
    fire('session:chat', update({ reset: false, messages: [{ id: 'a1', role: 'assistant', blocks: [{ kind: 'text', text: 'two' }] }] }));
    fire('session:chat', update({ sessionId: 'other', messages: [] }));
    expect(container.querySelectorAll('.argus-chat-msg')).toHaveLength(2);
  });

  it('sends the composer text through the pty, then Enter as a separate write', () => {
    vi.useFakeTimers();
    const { socket, fire } = fakeSocket();
    const { onSend } = render(session(), socket);
    fire('session:chat', update({ messages: [] }));
    const box = container.querySelector('textarea')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(box, 'hello');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => { box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(onSend).toHaveBeenCalledWith('hello');
    expect(onSend).not.toHaveBeenCalledWith('\r');
    act(() => { vi.advanceTimersByTime(CHAT_ENTER_DELAY_MS); });
    expect(onSend).toHaveBeenLastCalledWith('\r');
    expect(box.value).toBe('');
  });

  it('disables the composer for an exited session', () => {
    const { socket } = fakeSocket();
    render(session({ status: 'exited' }), socket);
    expect(container.querySelector('textarea')?.disabled).toBe(true);
  });

  it('shows the permission mode from the snapshot, then live from the screen', () => {
    const { socket, fire } = fakeSocket();
    render(session(), socket);
    fire('session:chat', update({ permissionMode: 'default' }));
    expect(container.querySelector('.argus-chat-composer-meta')?.textContent).toContain('Manual');
    fire('session:chatMode', { sessionId: 's1', permissionMode: 'plan' });
    expect(container.querySelector('.argus-chat-composer-meta')?.textContent).toContain('Plan');
  });
});
