import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AgentRun, SessionInfo, SessionViewMode } from '@argus/shared';
import { Focus } from './Focus.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// The terminal mode spawns a real xterm over the socket; only whether Focus
// mounts it matters here.
vi.mock('../../hooks/useTerminal.js', () => ({
  useTerminal: () => ({ terminalRef: { current: null } }),
}));
vi.mock('../../hooks/useSocket.js', () => ({
  useSocket: () => ({ on: () => {}, off: () => {}, emit: () => {} }),
}));
vi.mock('../../context/theme-context.js', () => ({
  useTheme: () => ({ theme: 'dark' }),
}));
vi.mock('./keyboard/MobileKeyboard.js', () => ({
  MobileKeyboard: () => <div data-testid="mobile-keyboard" />,
}));
// The chat view subscribes over the socket; here only whether Focus mounts it,
// and what its "back to the terminal" paths do, matters.
vi.mock('../ui/chat/ChatView.js', () => ({
  TERMINAL_SHEET_BAR_PX: 36,
  ChatView: ({ session, onShowTerminal, onTerminalSheet, onOpenAgent, sheetCloseRequest }: {
    session: SessionInfo; onShowTerminal: () => void; onTerminalSheet?: (open: boolean, command?: string) => void;
    onOpenAgent?: (a: AgentRun) => void; sheetCloseRequest?: number;
  }) => (
    <section data-testid="chat-view" data-close-request={sheetCloseRequest ?? 0}>
      <button type="button" data-testid="show-terminal" onClick={onShowTerminal} />
      <button type="button" data-testid="sheet-open" onClick={() => onTerminalSheet?.(true, 'usage')} />
      <button type="button" data-testid="sheet-close" onClick={() => onTerminalSheet?.(false)} />
      <button type="button" data-testid="open-agent" onClick={() => onOpenAgent?.(session.agents![0])} />
    </section>
  ),
}));
vi.mock('../../services/api.js', () => ({
  api: { getAgentChat: () => Promise.resolve({ available: true, messages: [], offset: 0 }) },
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function session(over: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 's1', name: 'api', folderPath: '/repo/api', status: 'idle',
    createdAt: new Date().toISOString(), agentType: 'claude', flags: [], ...over,
  };
}

function render(s: SessionInfo, viewMode: SessionViewMode | null, onSetViewMode: (m: SessionViewMode) => void = () => {}) {
  act(() => root.render(
    <Focus session={s} viewMode={viewMode} onSetViewMode={onSetViewMode} onBack={() => {}} onActions={() => {}} />,
  ));
}

const q = (sel: string) => container.querySelector(sel);

describe('mobile Focus view mode', () => {
  it('shows the terminal and its keyboard in terminal mode', () => {
    render(session(), 'terminal');
    expect(q('[data-testid="mobile-terminal"]')).not.toBeNull();
    expect(q('[data-testid="mobile-keyboard"]')).not.toBeNull();
    expect(q('[data-testid="chat-view"]')).toBeNull();
  });

  it('shows the chat instead of the terminal in chat mode', () => {
    render(session(), 'chat');
    expect(q('[data-testid="chat-view"]')).not.toBeNull();
    // Unmounted, not hidden: a phone reading the chat must not size the pty.
    expect(q('[data-testid="mobile-terminal"]')).toBeNull();
    expect(q('[data-testid="mobile-keyboard"]')).toBeNull();
  });

  it('covers the body until the default view is known', () => {
    render(session(), null);
    expect(q('[data-testid="chat-view"]')).toBeNull();
    expect(q('[data-testid="mobile-terminal"]')).toBeNull();
  });

  it('keeps Codex and Gemini on the terminal whatever the mode', () => {
    for (const agentType of ['codex', 'gemini']) {
      render(session({ agentType }), 'chat');
      expect(q('[data-testid="chat-view"]')).toBeNull();
      expect(q('[data-testid="mobile-terminal"]')).not.toBeNull();
      render(session({ agentType }), null);
      expect(q('[data-testid="mobile-terminal"]')).not.toBeNull();
    }
  });

  it('switches to the terminal when the chat asks for it', () => {
    const set = vi.fn();
    render(session(), 'chat', set);
    act(() => (q('[data-testid="show-terminal"]') as HTMLButtonElement).click());
    expect(set).toHaveBeenLastCalledWith('terminal');
  });
});

describe('mobile Focus command terminal', () => {
  const click = (id: string) => act(() => (q(`[data-testid="${id}"]`) as HTMLButtonElement).click());
  const chatBox = () => q('[data-testid="chat-view"]')?.parentElement as HTMLElement;
  // Hidden by visibility only: display: none would drop the chat's scroll offset.
  const chatHidden = () => {
    expect(chatBox().style.display).not.toBe('none');
    expect(chatBox().hidden).toBe(false);
    return chatBox().style.visibility === 'hidden';
  };

  it('shows the terminal for a command run from the chat, keeping the chat mounted and the stored choice', () => {
    const set = vi.fn();
    render(session(), 'chat', set);
    click('sheet-open');
    expect(q('[data-testid="mobile-terminal"]')).not.toBeNull();
    // Still mounted, so it sees the command's dialog close.
    expect(q('[data-testid="chat-view"]')).not.toBeNull();
    expect(chatHidden()).toBe(true);
    expect(q('[data-testid="command-terminal-bar"]')?.textContent).toContain('/usage');
    expect(set).not.toHaveBeenCalled();
  });

  it('goes back to the chat once the command is done', () => {
    render(session(), 'chat');
    click('sheet-open');
    click('sheet-close');
    expect(q('[data-testid="mobile-terminal"]')).toBeNull();
    expect(q('[data-testid="command-terminal-bar"]')).toBeNull();
    expect(chatHidden()).toBe(false);
  });

  it('Back to chat returns at once and asks the chat to close its sheet', () => {
    render(session(), 'chat');
    click('sheet-open');
    act(() => (q('[data-testid="command-terminal-bar"] button') as HTMLButtonElement).click());
    expect(q('[data-testid="mobile-terminal"]')).toBeNull();
    expect(chatHidden()).toBe(false);
    expect(q('[data-testid="chat-view"]')?.getAttribute('data-close-request')).toBe('1');
  });

  it('a terminal chosen from the menu stays when the command ends', () => {
    const set = vi.fn();
    render(session(), 'chat', set);
    click('sheet-open');
    render(session(), 'terminal', set);
    expect(q('[data-testid="mobile-terminal"]')).not.toBeNull();
    expect(q('[data-testid="chat-view"]')).toBeNull();
    expect(q('[data-testid="command-terminal-bar"]')).toBeNull();
  });
});

describe('mobile Focus agent sheet', () => {
  const agent: AgentRun = {
    id: 'a1', toolUseId: 'toolu_a', agentType: 'Explore', description: 'Find callers', background: false,
    depth: 1, startedAt: 1, status: 'running', outputTokens: 0,
  };

  it('the sheet renders full screen over the chat', async () => {
    render(session({ agents: [agent] }), 'chat');
    await act(async () => { q('[data-testid="open-agent"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const sheet = q('[data-testid="agent-sheet"]') as HTMLElement | null;
    expect(sheet).not.toBeNull();
    expect(sheet!.style.position).toBe('fixed');
    expect(sheet!.textContent).toContain('Find callers');
    // The chat stays mounted under it.
    expect(q('[data-testid="chat-view"]')).not.toBeNull();
    await act(async () => { (sheet!.querySelector('button[aria-label="Back"]') as HTMLButtonElement).click(); });
    expect(q('[data-testid="agent-sheet"]')).toBeNull();
  });
});
