import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ChatMessage, ChatUpdate, SessionInfo } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import { ChatView } from './ChatView.js';
import { api } from '../../../services/api.js';
import { ANSWER_TIMEOUT_MS } from './ChatPromptCard.js';

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

function render(s: SessionInfo, socket: Socket<any, any>, onShowTerminal = vi.fn()) { // eslint-disable-line @typescript-eslint/no-explicit-any
  act(() => {
    root.render(<ChatView session={s} socket={socket} onShowTerminal={onShowTerminal} />);
  });
  return { onShowTerminal };
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

  it('renders slash commands, collapsed command output, notices and echoes', () => {
    const { socket, fire } = fakeSocket();
    render(session(), socket);
    const messages: ChatMessage[] = [
      { id: 'c1', role: 'user', blocks: [{ kind: 'command', name: '/model', args: 'opus' }] },
      { id: 'o1', role: 'system', blocks: [{ kind: 'output', stream: 'stdout', text: 'Set model to Opus 5.5\nsecond line' }] },
      { id: 'n1', role: 'system', blocks: [{ kind: 'notice', text: 'Unknown command: /foo' }] },
      { id: 'echo-1', role: 'user', echo: true, blocks: [{ kind: 'command', name: '/cost' }] },
    ];
    fire('session:chat', update({ messages }));
    const cmds = Array.from(container.querySelectorAll('[data-testid="chat-command"]')).map((el) => el.textContent);
    expect(cmds).toEqual(['/model opus', '/cost']);
    const out = container.querySelector<HTMLDetailsElement>('[data-testid="chat-output"]')!;
    expect(out.open).toBe(false);
    expect(out.querySelector('summary')?.textContent).toContain('Set model to Opus 5.5');
    expect(out.querySelector('pre')?.textContent).toBe('Set model to Opus 5.5\nsecond line');
    expect(container.textContent).toContain('Unknown command: /foo');
    // System rows carry no role label; the echo is marked as one.
    expect(Array.from(container.querySelectorAll('.argus-chat-role')).map((el) => el.textContent)).toEqual(['You', 'You']);
    expect(container.querySelector('.argus-chat-msg.is-echo')?.getAttribute('data-role')).toBe('user');
  });

  it('shows what Claude waits for with the real menu options, answered through session:answer', () => {
    const { socket, fire, emitted } = fakeSocket();
    render(session({ status: 'waiting', lastPrompt: 'Do you want to run git push?', promptOptions: [{ key: '1', label: 'Yes' }, { key: '2', label: 'No' }] }), socket);
    fire('session:chat', update({}));
    const card = container.querySelector('[data-testid="chat-prompt"]')!;
    expect(card.textContent).toContain('Do you want to run git push?');
    const buttons = Array.from(card.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toEqual(['1 · Yes', '2 · No']);
    act(() => (card.querySelector('button') as HTMLButtonElement).click());
    expect(emitted.find(([ev]) => ev === 'session:answer')?.[1]).toEqual({ sessionId: 's1', key: '1' });
    expect(container.textContent).not.toContain('y · accept');
  });

  it('an answer with no reply frees the buttons again with an error', async () => {
    vi.useFakeTimers();
    const { socket, fire } = fakeSocket(); // its emit never calls the ack
    render(session({ status: 'waiting', promptOptions: [{ key: '1', label: 'Yes' }, { key: '2', label: 'No' }] }), socket);
    fire('session:chat', update({}));
    const yes = container.querySelector('[data-testid="chat-prompt"] button') as HTMLButtonElement;
    act(() => yes.click());
    expect(yes.disabled).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(ANSWER_TIMEOUT_MS); });
    expect(yes.disabled).toBe(false);
    expect(container.querySelector('[data-testid="chat-prompt"]')?.textContent).toContain('No reply from Argus');
  });

  it('a menu without readable options (a picker) points to the terminal instead', () => {
    const { socket, fire, emitted } = fakeSocket();
    const { onShowTerminal } = render(session({ status: 'waiting' }), socket);
    fire('session:chat', update({}));
    const card = container.querySelector('[data-testid="chat-prompt"]')!;
    expect(card.textContent).toContain('showing a menu in the terminal');
    const [open, cancel] = Array.from(card.querySelectorAll('button'));
    act(() => open.click());
    expect(onShowTerminal).toHaveBeenCalled();
    act(() => cancel.click());
    expect(emitted).toContainEqual(['session:input', { sessionId: 's1', data: '\x1b' }]);
  });

  it('/resume opens the Chat picker; picking sends /resume <id> instead of the terminal picker', async () => {
    const list = vi.spyOn(api, 'listConversations').mockResolvedValue([
      { id: 'aaaaaaaa-1111-4222-8333-444444444444', title: 'Fix the login bug', updatedAt: Date.now() - 3_600_000 },
      { id: 'bbbbbbbb-1111-4222-8333-444444444444', title: 'Dashboard RBAC', updatedAt: Date.now() - 60_000, current: true },
    ]);
    const { socket, fire, emitted } = fakeSocket();
    const { onShowTerminal } = render(session(), socket);
    fire('session:chat', update({}));
    const box = container.querySelector('textarea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, '/resume');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => { box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(emitted.some(([ev]) => ev === 'session:chat:send')).toBe(false);
    await act(async () => {});
    expect(list).toHaveBeenCalledWith('s1');
    const picker = container.querySelector('[data-testid="chat-resume"]')!;
    expect(Array.from(picker.querySelectorAll('.argus-chat-resume-title')).map((t) => t.textContent)).toEqual(['Fix the login bug', 'Dashboard RBAC']);
    expect(picker.textContent).toContain('current');

    // The filter narrows the list; Enter resumes the highlighted one.
    const filter = picker.querySelector('input')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(filter, 'rbac');
      filter.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => { filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(emitted).toContainEqual(['session:chat:send', { sessionId: 's1', text: '/resume bbbbbbbb-1111-4222-8333-444444444444' }]);
    expect(container.querySelector('[data-testid="chat-resume"]')).toBeNull();
    expect(onShowTerminal).not.toHaveBeenCalled();
    list.mockRestore();
  });

  it('the picker can hand over to the terminal picker', async () => {
    const list = vi.spyOn(api, 'listConversations').mockResolvedValue([]);
    const { socket, fire, emitted } = fakeSocket();
    const { onShowTerminal } = render(session(), socket);
    fire('session:chat', update({}));
    const box = container.querySelector('textarea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, '/resume');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => { box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    await act(async () => {});
    expect(container.textContent).toContain('No earlier conversations in this folder.');
    const inTerminal = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('In terminal'))!;
    act(() => inTerminal.click());
    expect(emitted).toContainEqual(['session:chat:send', { sessionId: 's1', text: '/resume' }]);
    expect(onShowTerminal).toHaveBeenCalled();
    list.mockRestore();
  });

  it('appends new messages and ignores other sessions', () => {
    const { socket, fire } = fakeSocket();
    render(session(), socket);
    fire('session:chat', update({ messages: [{ id: 'u1', role: 'user', blocks: [{ kind: 'text', text: 'one' }] }] }));
    fire('session:chat', update({ reset: false, messages: [{ id: 'a1', role: 'assistant', blocks: [{ kind: 'text', text: 'two' }] }] }));
    fire('session:chat', update({ sessionId: 'other', messages: [] }));
    expect(container.querySelectorAll('.argus-chat-msg')).toHaveLength(2);
  });

  it('submits the composer text with session:chat:send', () => {
    const { socket, fire, emitted } = fakeSocket();
    render(session(), socket);
    fire('session:chat', update({ messages: [] }));
    const box = container.querySelector('textarea')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(box, 'hello');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => { box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(emitted).toContainEqual(['session:chat:send', { sessionId: 's1', text: 'hello' }]);
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
