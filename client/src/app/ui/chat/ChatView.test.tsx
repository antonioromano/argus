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
          { kind: 'tool', id: 't1', name: 'Bash', label: 'List files', status: 'ok' },
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
    expect(container.textContent).toContain('List files');
    expect(container.textContent).toContain('hologram');
  });

  it('folds consecutive tool-only messages into one group that a joined result updates in place', () => {
    const { socket, fire } = fakeSocket();
    render(session(), socket);
    const call = (id: string, name: string, label: string, status: 'ok' | 'pending' | 'blocked'): ChatMessage => ({
      id: `a-${id}`,
      role: 'assistant',
      blocks: [{ kind: 'tool', id, name, label, status }],
    });
    fire(
      'session:chat',
      update({
        messages: [
          { id: 'u1', role: 'user', blocks: [{ kind: 'text', text: 'go' }] },
          call('t1', 'Bash', 'List files', 'ok'),
          call('t2', 'Read', 'a.ts', 'blocked'),
          call('t3', 'Bash', 'Run tests', 'pending'),
        ],
      }),
    );
    const groups = container.querySelectorAll('[data-testid="chat-tool-group"]');
    expect(groups).toHaveLength(1);
    expect(groups[0].textContent).toContain('Ran 2 commands, read 1 file (1 blocked, 1 running)');
    // One row for the run, under a single "Claude" label.
    expect(Array.from(container.querySelectorAll('.argus-chat-msg')).map((el) => el.getAttribute('data-role'))).toEqual(['user', 'assistant']);

    fire('session:chat', update({ reset: false, messages: [call('t3', 'Bash', 'Run tests', 'ok')] }));
    expect(container.querySelector('[data-testid="chat-tool-group"]')?.textContent).toContain('Ran 2 commands, read 1 file (1 blocked)');
    expect(container.querySelectorAll('[data-testid="chat-tool-group"]')).toHaveLength(1);
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
    expect(buttons).toEqual(['1Yes', '2No']);
    act(() => (card.querySelector('button') as HTMLButtonElement).click());
    expect(emitted.find(([ev]) => ev === 'session:answer')?.[1]).toEqual({ sessionId: 's1', key: '1' });
    expect(container.textContent).not.toContain('y · accept');
  });

  it('prefers the menu question read off the screen and sends a free-text answer with its text', () => {
    const { socket, fire, emitted } = fakeSocket();
    render(session({
      status: 'waiting',
      lastPrompt: 'Claude needs your permission',
      promptQuestion: 'Tea or coffee?',
      promptOptions: [{ key: '1', label: 'Tea' }, { key: '2', label: 'Type something.', freeText: true }],
    }), socket);
    fire('session:chat', update({}));
    const card = container.querySelector('[data-testid="chat-prompt"]')!;
    expect(card.textContent).toContain('Tea or coffee?');
    expect(card.textContent).not.toContain('needs your permission');
    act(() => Array.from(card.querySelectorAll('button')).find((b) => b.textContent?.includes('Type something'))!.click());
    const input = card.querySelector<HTMLInputElement>('[data-testid="chat-prompt-free"] input')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'matcha');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(emitted.find(([ev]) => ev === 'session:answer')?.[1]).toEqual({ sessionId: 's1', key: '2', text: 'matcha' });
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

  describe('Stop (F3)', () => {
    const esc = (meta: boolean) => {
      const event = new KeyboardEvent('keydown', { key: 'Escape', metaKey: meta, bubbles: true, cancelable: true });
      act(() => { container.querySelector('textarea')!.dispatchEvent(event); });
      return event;
    };
    const interrupts = (emitted: Array<[string, unknown]>) =>
      emitted.filter(([ev, p]) => ev === 'session:input' && (p as { data: string }).data === '\x1b').length;

    it('the Stop button writes Esc to the pty while running', () => {
      const { socket, emitted } = fakeSocket();
      render(session({ status: 'running' }), socket);
      act(() => (container.querySelector('button[aria-label="Stop (⌘Esc)"]') as HTMLButtonElement).click());
      expect(emitted).toContainEqual(['session:input', { sessionId: 's1', data: '\x1b' }]);
    });

    it('⌘Esc stops a running turn and never reaches the window Escape handler', () => {
      const { socket, emitted } = fakeSocket();
      const onWindowKey = vi.fn();
      window.addEventListener('keydown', onWindowKey);
      try {
        render(session({ status: 'running' }), socket);
        expect(esc(true).defaultPrevented).toBe(true);
        expect(interrupts(emitted)).toBe(1);
        expect(onWindowKey).not.toHaveBeenCalled();
        // Plain Esc keeps its behaviour: it bubbles on and types nothing.
        esc(false);
        expect(onWindowKey).toHaveBeenCalledTimes(1);
        expect(interrupts(emitted)).toBe(1);
      } finally {
        window.removeEventListener('keydown', onWindowKey);
      }
    });

    it('⌘Esc still stops once a clicked Stop has dropped focus to the body', () => {
      const { socket, emitted } = fakeSocket();
      render(session({ status: 'running' }), socket);
      act(() => { container.querySelector('[data-testid="chat-view"]')!.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
      (document.activeElement as HTMLElement | null)?.blur();
      const event = new KeyboardEvent('keydown', { key: 'Escape', metaKey: true, bubbles: true, cancelable: true });
      act(() => { document.body.dispatchEvent(event); });
      expect(event.defaultPrevented).toBe(true);
      expect(interrupts(emitted)).toBe(1);
    });

    it('⌘Esc sends nothing when no turn is running', () => {
      const { socket, emitted } = fakeSocket();
      render(session({ status: 'idle' }), socket);
      esc(true);
      expect(interrupts(emitted)).toBe(0);
    });
  });

  describe('sent prompts and Stop feedback (F3)', () => {
    const typeAndSend = (text: string) => {
      const box = container.querySelector('textarea')!;
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, text);
        box.dispatchEvent(new Event('input', { bubbles: true }));
      });
      act(() => { box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    };
    const userBodies = () => Array.from(container.querySelectorAll('.argus-chat-msg.is-user')).map((m) => m.textContent);
    const stopButton = () => container.querySelector('button[aria-label="Stop (⌘Esc)"]') as HTMLButtonElement;
    const history = [{ id: 'u0', role: 'user' as const, blocks: [{ kind: 'text' as const, text: 'before' }] }];

    it('shows a sent prompt at once, then the transcript copy replaces it', () => {
      const { socket, fire } = fakeSocket();
      render(session(), socket);
      fire('session:chat', update({ messages: history }));
      typeAndSend('hello there');
      expect(userBodies()).toEqual(['Youbefore', 'hello there']);
      expect(container.querySelectorAll('.argus-chat-msg.is-pending')).toHaveLength(1);

      fire('session:chat', update({ messages: [...history, { id: 'u1', role: 'user', blocks: [{ kind: 'text', text: 'hello there' }] }] }));
      expect(userBodies()).toEqual(['Youbefore', 'hello there']);
      expect(container.querySelector('.argus-chat-msg.is-pending')).toBeNull();
    });

    it('a prompt with an attachment shows at once too (its text starts with the path)', () => {
      const { socket, fire } = fakeSocket();
      (window as Window & { electronFiles?: unknown }).electronFiles = { getPath: () => '/var/folders/x/shot.png' };
      render(session(), socket);
      fire('session:chat', update({ messages: history }));
      const input = container.querySelector('[data-testid="chat-file-input"]') as HTMLInputElement;
      URL.createObjectURL = vi.fn(() => 'blob:preview');
      Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], 'shot.png', { type: 'image/png' })] });
      act(() => { input.dispatchEvent(new Event('change', { bubbles: true })); });
      typeAndSend('look at this');
      const pending = container.querySelector('.argus-chat-msg.is-pending');
      expect(pending?.textContent).toContain('look at this');
      expect(pending?.querySelector('.argus-chat-chip')?.textContent).toContain('image');
      delete (window as Window & { electronFiles?: unknown }).electronFiles;
    });

    it('a slash command is not echoed by the client', () => {
      const { socket, fire } = fakeSocket();
      render(session(), socket);
      fire('session:chat', update({ messages: history }));
      typeAndSend('/cost');
      expect(container.querySelector('.argus-chat-msg.is-pending')).toBeNull();
    });

    it('Stop says "Stopping…" until the turn ends, and a prompt stopped unrecorded stays visible', () => {
      const { socket, fire, emitted } = fakeSocket();
      render(session({ status: 'running' }), socket);
      fire('session:chat', update({ messages: history }));
      typeAndSend('do the thing');
      act(() => stopButton().click());
      expect(stopButton().disabled).toBe(true);
      expect(container.querySelector('.argus-chat-hint')?.textContent).toBe('Stopping…');
      // A second click while stopping types nothing more.
      act(() => stopButton().click());
      expect(emitted.filter(([ev]) => ev === 'session:input')).toHaveLength(1);

      render(session({ status: 'idle' }), socket);
      expect(container.querySelector('.argus-chat-hint')?.textContent).not.toBe('Stopping…');
      const last = container.querySelectorAll('.argus-chat-msg.is-user');
      expect(last[last.length - 1].textContent).toContain('do the thing');
      expect(last[last.length - 1].textContent).toContain('Stopped before Claude recorded it');
    });

    it('a recorded prompt stopped before any reply is marked "Stopped"', () => {
      const { socket, fire } = fakeSocket();
      render(session({ status: 'running' }), socket);
      fire('session:chat', update({ messages: history }));
      act(() => stopButton().click());
      expect(container.textContent).not.toContain('Stopped');
      render(session({ status: 'idle' }), socket);
      const mine = container.querySelectorAll('.argus-chat-msg.is-user');
      expect(mine[mine.length - 1].querySelector('.argus-chat-notice')?.textContent).toContain('Stopped');
    });

    it('no client mark once Claude replied: the turn had ended, or Claude Code marks it itself', () => {
      const { socket, fire } = fakeSocket();
      render(session({ status: 'running' }), socket);
      fire('session:chat', update({ messages: history }));
      act(() => stopButton().click());
      fire('session:chat', update({ messages: [...history, { id: 'a1', role: 'assistant', blocks: [{ kind: 'text', text: 'done' }] }] }));
      render(session({ status: 'idle' }), socket);
      expect(container.querySelector('.argus-chat-msg.is-user .argus-chat-notice')).toBeNull();
    });

    it('a prompt sent while Claude runs reads as queued, after the running turn, until Claude reads it', () => {
      const { socket, fire } = fakeSocket();
      render(session({ status: 'running' }), socket);
      fire('session:chat', update({ messages: history }));
      typeAndSend('also update the docs');
      const queued = container.querySelector('.argus-chat-msg.is-pending.is-queued');
      expect(queued?.textContent).toContain('also update the docs');
      const label = queued?.querySelector('[data-testid="chat-queued"]');
      expect(label?.textContent).toContain('Queued');
      expect(label?.getAttribute('title')).toBe('Claude will read this when it finishes the current step');

      // The running turn keeps going: the queued prompt stays last.
      fire('session:chat', update({ reset: false, messages: [{ id: 'a1', role: 'assistant', blocks: [{ kind: 'text', text: 'working' }] }] }));
      const all = Array.from(container.querySelectorAll('.argus-chat-msg'));
      expect(all[all.length - 1].classList.contains('is-queued')).toBe(true);

      // Claude reads it (a queued_command attachment mid-turn, or a user entry): replaced exactly once.
      fire('session:chat', update({ reset: false, messages: [{ id: 'q1', role: 'user', blocks: [{ kind: 'text', text: 'also update the docs' }] }] }));
      expect(container.querySelector('.argus-chat-msg.is-pending')).toBeNull();
      expect(userBodies().filter((t) => t?.includes('also update the docs'))).toHaveLength(1);
    });

    it('a prompt sent while idle is pending, not queued', () => {
      const { socket, fire } = fakeSocket();
      render(session(), socket);
      fire('session:chat', update({ messages: history }));
      typeAndSend('hi');
      expect(container.querySelector('.argus-chat-msg.is-pending')).not.toBeNull();
      expect(container.querySelector('[data-testid="chat-queued"]')).toBeNull();
    });

    it('several queued prompts keep their send order and settle one by one', () => {
      const { socket, fire } = fakeSocket();
      render(session({ status: 'running' }), socket);
      fire('session:chat', update({ messages: history }));
      typeAndSend('one');
      typeAndSend('two');
      typeAndSend('one');
      const queuedTexts = () => Array.from(container.querySelectorAll('.argus-chat-msg.is-queued .argus-chat-body')).map((b) => b.textContent);
      expect(queuedTexts()).toEqual(['one', 'two', 'one']);
      fire('session:chat', update({ reset: false, messages: [{ id: 'u1', role: 'user', blocks: [{ kind: 'text', text: 'one' }] }] }));
      expect(queuedTexts()).toEqual(['two', 'one']);
      fire('session:chat', update({ reset: false, messages: [{ id: 'u2', role: 'user', blocks: [{ kind: 'text', text: 'two' }] }, { id: 'u3', role: 'user', blocks: [{ kind: 'text', text: 'one' }] }] }));
      expect(queuedTexts()).toEqual([]);
      expect(userBodies()).toEqual(['Youbefore', 'one', 'two', 'one']);
    });

    it('a queue Claude finished without reading is marked, then dropped once the conversation moves on', () => {
      vi.useFakeTimers();
      const { socket, fire } = fakeSocket();
      render(session({ status: 'running' }), socket);
      fire('session:chat', update({ messages: history }));
      typeAndSend('lost one');
      // The turn ends and the queue was dropped (Esc in the terminal): nothing is recorded.
      render(session({ status: 'idle' }), socket);
      act(() => { vi.advanceTimersByTime(4000); });
      expect(container.querySelector('[data-testid="chat-queued"]')).not.toBeNull();
      act(() => { vi.advanceTimersByTime(1000); });
      expect(container.querySelector('[data-testid="chat-queued"]')).toBeNull();
      const last = container.querySelectorAll('.argus-chat-msg.is-user');
      expect(last[last.length - 1].textContent).toContain('lost one');
      expect(last[last.length - 1].textContent).toContain('Claude finished without reading it');

      fire('session:chat', update({ reset: false, messages: [{ id: 'u1', role: 'user', blocks: [{ kind: 'text', text: 'something new' }] }] }));
      expect(container.textContent).not.toContain('lost one');
    });

    it('a queued prompt Claude reads as soon as the turn ends is never marked dropped', () => {
      vi.useFakeTimers();
      const { socket, fire } = fakeSocket();
      render(session({ status: 'running' }), socket);
      fire('session:chat', update({ messages: history }));
      typeAndSend('next');
      render(session({ status: 'idle' }), socket);
      fire('session:chat', update({ reset: false, messages: [{ id: 'u1', role: 'user', blocks: [{ kind: 'text', text: 'next' }] }] }));
      act(() => { vi.advanceTimersByTime(10_000); });
      expect(container.textContent).not.toContain('without reading');
      expect(userBodies()).toEqual(['Youbefore', 'next']);
    });

    it('Stop marks queued prompts stopped, not queued', () => {
      const { socket, fire } = fakeSocket();
      render(session({ status: 'running' }), socket);
      fire('session:chat', update({ messages: history }));
      typeAndSend('queued then stopped');
      act(() => stopButton().click());
      expect(container.querySelector('[data-testid="chat-queued"]')).toBeNull();
      render(session({ status: 'idle' }), socket);
      expect(container.textContent).toContain('Stopped before Claude recorded it');
    });

    it('gives the Stop button back when the turn keeps running', () => {
      vi.useFakeTimers();
      const { socket } = fakeSocket();
      render(session({ status: 'running' }), socket);
      act(() => stopButton().click());
      expect(stopButton().disabled).toBe(true);
      act(() => { vi.advanceTimersByTime(8000); });
      expect(stopButton().disabled).toBe(false);
    });
  });
});
