import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionInfo, SessionViewMode } from '@argus/shared';
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
  ChatView: ({ onShowTerminal, onTerminalSheet }: { onShowTerminal: () => void; onTerminalSheet?: (open: boolean) => void }) => (
    <section data-testid="chat-view">
      <button type="button" data-testid="show-terminal" onClick={onShowTerminal} />
      <button type="button" data-testid="sheet-open" onClick={() => onTerminalSheet?.(true)} />
    </section>
  ),
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

  it('switches to the terminal when the chat asks for it, or runs a command there', () => {
    const set = vi.fn();
    render(session(), 'chat', set);
    act(() => (q('[data-testid="show-terminal"]') as HTMLButtonElement).click());
    expect(set).toHaveBeenLastCalledWith('terminal');
    act(() => (q('[data-testid="sheet-open"]') as HTMLButtonElement).click());
    expect(set).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenLastCalledWith('terminal');
  });
});
