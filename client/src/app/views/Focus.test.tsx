import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionInfo, MosaicOrientation, SessionViewMode } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import { Focus } from './Focus.js';
import type { SidePanel } from '../types.js';
import { suppress, registerOverlay, resetOverlayRegistryForTests } from '../../hooks/nativeOverlayRegistry.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// Focus keeps a real TerminalShell mounted at all times (see the comment above
// its render), which drags in xterm.js/native-terminal plumbing this test has
// no interest in. Stubbing it isolates the things under test: the "Native"
// marker in Focus's own header and the exited-session card over the terminal.
vi.mock('../ui/TerminalShell.js', () => ({
  TerminalShell: ({ requestFocusToken }: { requestFocusToken?: number }) => <i data-testid="terminal-shell" data-focus-token={requestFocusToken} />,
}));
// The companion shell spawns a real xterm; only its placement matters here.
vi.mock('../../hooks/useCompanionTerminal.js', () => ({
  useCompanionTerminal: () => ({ terminalAlive: true }),
}));
// The activity panel has its own tests; here only whether Focus mounts it matters.
vi.mock('../panels/ActivityPanel.js', () => ({
  ActivityPanel: () => <aside data-testid="activity-panel" />,
}));

// The PR diff reads over the API; here only whether Focus mounts it, and for which PR, matters.
vi.mock('../panels/PrDiffView.js', () => ({
  PrDiffView: ({ entry }: { entry: { url: string } }) => <section data-testid="pr-diff-view" data-url={entry.url} />,
}));

// The chat view subscribes over the socket; here only whether Focus mounts it matters.
vi.mock('../ui/chat/ChatView.js', () => ({
  TERMINAL_SHEET_BAR_PX: 36,
  ChatView: ({ onTerminalSheet }: { onTerminalSheet?: (open: boolean) => void }) => (
    <section data-testid="chat-view">
      <button type="button" data-testid="sheet-open" onClick={() => onTerminalSheet?.(true)} />
      <button type="button" data-testid="sheet-close" onClick={() => onTerminalSheet?.(false)} />
    </section>
  ),
}));

let container: HTMLDivElement;
let root: Root;

const noop = () => {};
const socket = {} as unknown as Socket<any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function session(over: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 's1',
    name: 'billing spike',
    folderPath: '/repo',
    status: 'idle',
    createdAt: new Date().toISOString(),
    agentType: 'claude',
    flags: [],
    ...over,
  };
}

function renderFocus(
  active: SessionInfo,
  onRestart: () => void = noop,
  opts: { sidePanel?: SidePanel; orientation?: MosaicOrientation; activityEnabled?: boolean; inspectorColumn?: boolean; inspectorShown?: boolean; defaultSessionView?: SessionViewMode | null } = {},
) {
  act(() => {
    root.render(
      <Focus
        sessions={[active]}
        active={active}
        socket={socket}
        theme="dark"
        sidePanel={opts.sidePanel ?? null}
        orientation={opts.orientation}
        inspectorColumn={opts.inspectorColumn}
        inspectorShown={opts.inspectorShown}
        defaultSessionView={opts.defaultSessionView}
        onSelect={noop}
        onReorder={noop}
        onBack={noop}
        onToggleDiff={noop}
        onToggleExplorer={noop}
        onToggleTerminal={noop}
        activityEnabled={opts.activityEnabled}
        onToggleActivity={noop}
        onExpandDiff={noop}
        onOpenFileInEditor={noop}
        onRestore={noop}
        onClone={noop}
        onKill={noop}
        onRestart={onRestart}
        onDumpDiagnostics={noop}
        showDiagnostics={false}
      />,
    );
  });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { root = createRoot(container); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  vi.clearAllMocks();
});

describe('Focus header — Native marker', () => {
  it('renders the "Native" marker for a direct session', () => {
    renderFocus(session({ runMode: 'direct' }));
    const marker = Array.from(container.querySelectorAll('.argus-tile-branch'))
      .find((el) => el.textContent === 'Native');
    expect(marker).toBeDefined();
  });

  it('does not render the "Native" marker for a persistent session', () => {
    renderFocus(session({ runMode: 'persistent' }));
    const marker = Array.from(container.querySelectorAll('.argus-tile-branch'))
      .find((el) => el.textContent === 'Native');
    expect(marker).toBeUndefined();
  });
});

describe('Focus — exited card', () => {
  it('shows the card over an exited session and restarts from it', () => {
    const onRestart = vi.fn();
    renderFocus(session({ runMode: 'direct', status: 'exited' }), onRestart);
    const card = container.querySelector('[data-testid="exited-card"]');
    expect(card?.textContent).toContain('Session stopped');
    const restart = Array.from(card!.querySelectorAll('button')).find((b) => b.textContent?.includes('Restart'));
    act(() => restart!.click());
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it('shows no card while the session is running', () => {
    renderFocus(session({ runMode: 'direct', status: 'running' }));
    expect(container.querySelector('[data-testid="exited-card"]')).toBeNull();
  });
});

describe('Focus — modal placeholder', () => {
  it('covers the terminal with a status-only placeholder while a full-screen sheet is open', () => {
    resetOverlayRegistryForTests();
    renderFocus(session({ status: 'running' }));
    expect(container.querySelector('[data-testid="modal-placeholder"]')).toBeNull();
    let h!: ReturnType<typeof suppress>;
    act(() => { h = suppress('all'); });
    const ph = container.querySelector('[data-testid="modal-placeholder"]');
    expect(ph?.querySelector('[data-status="running"]')).not.toBeNull();
    act(() => h.release());
    expect(container.querySelector('[data-testid="modal-placeholder"]')).toBeNull();
  });

  it('covers the terminal while its native overlay is hidden by a partial surface (popover, launch card)', () => {
    resetOverlayRegistryForTests();
    renderFocus(session({ status: 'running' }));
    act(() => { registerOverlay('s1', { x: 0, y: 0, width: 400, height: 300 }); });
    expect(container.querySelector('[data-testid="modal-placeholder"]')).toBeNull();
    let h!: ReturnType<typeof suppress>;
    act(() => { h = suppress({ x: 10, y: 10, width: 50, height: 50 }); });
    expect(container.querySelector('[data-testid="modal-placeholder"]')).not.toBeNull();
    act(() => h.release());
    expect(container.querySelector('[data-testid="modal-placeholder"]')).toBeNull();
  });
});

describe('Focus — companion shell placement', () => {
  const shellPanel: SidePanel = { kind: 'terminal', sessionId: 's1' };

  it('docks the shell beside the conversation in the side-by-side layout', () => {
    renderFocus(session(), noop, { sidePanel: shellPanel, orientation: 'horizontal' });
    const aside = container.querySelector('aside')!;
    expect(aside.style.width).not.toBe('');
    expect(aside.style.height).toBe('');
    expect((aside.parentElement as HTMLElement).style.flexDirection).toBe('row');
  });

  it('docks the shell below the conversation in the stacked layout', () => {
    renderFocus(session(), noop, { sidePanel: shellPanel, orientation: 'vertical' });
    const aside = container.querySelector('aside')!;
    expect(aside.style.height).not.toBe('');
    expect(aside.style.width).toBe('');
    expect((aside.parentElement as HTMLElement).style.flexDirection).toBe('column');
  });

  it('lets the bottom shell yield height so the conversation above keeps its minimum', () => {
    renderFocus(session(), noop, { sidePanel: shellPanel, orientation: 'vertical' });
    const aside = container.querySelector('aside')!;
    const conversation = aside.parentElement!.firstElementChild as HTMLElement;
    expect(aside.style.flexShrink).toBe('1');
    expect(aside.style.minHeight).toBe('0px');
    expect(conversation.style.minHeight).toBe('200px');
  });
});

describe('Focus — Session Inspector', () => {
  const shellPanel: SidePanel = { kind: 'terminal', sessionId: 's1' };
  const withChips = session({
    hasGitChanges: true,
    pr: { number: 42, state: 'open', url: 'https://github.com/o/r/pull/42', ci: 'success', branch: 'feat/x' },
  });

  it('moves the companion shell below the conversation while the inspector holds the right column', () => {
    renderFocus(session(), noop, { sidePanel: shellPanel, orientation: 'horizontal', inspectorColumn: true });
    const aside = container.querySelector('aside')!;
    expect(aside.style.height).not.toBe('');
    expect((aside.parentElement as HTMLElement).style.flexDirection).toBe('column');
  });

  it('drops the git and PR chips from the header while the inspector shows them', () => {
    renderFocus(withChips, noop, { inspectorShown: true });
    expect(container.querySelector('[data-testid="pr-chip"]')).toBeNull();
    expect(container.querySelector('[aria-label*="uncommitted"]')).toBeNull();
  });

  it('brings the chips back while the inspector is hidden', () => {
    renderFocus(withChips, noop, { inspectorShown: false });
    expect(container.querySelector('[data-testid="pr-chip"]')).not.toBeNull();
    expect(container.querySelector('[aria-label*="uncommitted"]')).not.toBeNull();
  });
});

describe('Focus — activity timeline (beta F6)', () => {
  const activityButton = () =>
    container.querySelector('button[aria-label="Activity"]') ?? undefined;

  it('shows the Activity button and the docked panel while the flag is on', () => {
    renderFocus(session(), noop, { activityEnabled: true, sidePanel: { kind: 'activity', sessionId: 's1' } });
    expect(activityButton()).toBeDefined();
    expect(container.querySelector('[data-testid="activity-panel"]')).not.toBeNull();
  });

  it('renders neither the button nor the panel while the flag is off', () => {
    renderFocus(session(), noop, { activityEnabled: false, sidePanel: { kind: 'activity', sessionId: 's1' } });
    expect(activityButton()).toBeUndefined();
    expect(container.querySelector('[data-testid="activity-panel"]')).toBeNull();
  });
});

describe('Focus — Terminal/Chat toggle (B1)', () => {
  const toggle = (label: string) =>
    Array.from(container.querySelectorAll('[aria-label="Session view"] button')).find((b) => b.textContent?.includes(label)) as HTMLButtonElement | undefined;

  beforeEach(() => window.localStorage.clear());

  it('starts on the terminal and switches a Claude session to chat and back', () => {
    renderFocus(session({ status: 'running' }));
    expect(container.querySelector('[data-testid="chat-view"]')).toBeNull();
    act(() => toggle('Chat')!.click());
    expect(container.querySelector('[data-testid="chat-view"]')).not.toBeNull();
    expect(window.localStorage.getItem('argus.sessionViewMode')).toContain('"s1":"chat"');
    act(() => toggle('Terminal')!.click());
    expect(container.querySelector('[data-testid="chat-view"]')).toBeNull();
  });

  it("insets the terminal below the Chat's terminal sheet and gives it the keyboard (F6)", () => {
    renderFocus(session({ status: 'idle' }));
    act(() => toggle('Chat')!.click());
    const shell = () => container.querySelector('[data-testid="terminal-shell"]') as HTMLElement;
    const region = () => shell().parentElement!;
    expect(region().style.paddingTop).toBe('0px');
    const token = Number(shell().dataset.focusToken);
    act(() => (container.querySelector('[data-testid="sheet-open"]') as HTMLButtonElement).click());
    expect(region().style.paddingTop).toBe('36px');
    expect(Number(shell().dataset.focusToken)).toBe(token + 1);
    act(() => (container.querySelector('[data-testid="sheet-close"]') as HTMLButtonElement).click());
    expect(region().style.paddingTop).toBe('0px');
  });

  it('keeps chat after leaving and re-entering Focus', () => {
    renderFocus(session({ status: 'running' }));
    act(() => toggle('Chat')!.click());
    act(() => root.render(<></>));
    renderFocus(session({ status: 'running' }));
    expect(container.querySelector('[data-testid="chat-view"]')).not.toBeNull();
  });

  it('remembers the chat choice for the session', () => {
    window.localStorage.setItem('argus.sessionViewMode', JSON.stringify({ s1: 'chat' }));
    renderFocus(session({ status: 'running' }));
    expect(container.querySelector('[data-testid="chat-view"]')).not.toBeNull();
  });

  it('opens a Claude session with no choice in chat when that is the default', () => {
    renderFocus(session({ status: 'running' }), noop, { defaultSessionView: 'chat' });
    expect(container.querySelector('[data-testid="chat-view"]')).not.toBeNull();
  });

  it('keeps an explicit terminal choice over a chat default', () => {
    window.localStorage.setItem('argus.sessionViewMode', JSON.stringify({ s1: 'terminal' }));
    renderFocus(session({ status: 'running' }), noop, { defaultSessionView: 'chat' });
    expect(container.querySelector('[data-testid="chat-view"]')).toBeNull();
  });

  it('covers the shell until the default is known, then shows it', () => {
    renderFocus(session({ status: 'running' }), noop, { defaultSessionView: null });
    expect(container.querySelector('[data-testid="view-pending"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="chat-view"]')).toBeNull();
    renderFocus(session({ status: 'running' }), noop, { defaultSessionView: 'chat' });
    expect(container.querySelector('[data-testid="view-pending"]')).toBeNull();
    expect(container.querySelector('[data-testid="chat-view"]')).not.toBeNull();
  });

  it('keeps Codex and Gemini on the terminal with a chat default', () => {
    for (const agentType of ['codex', 'gemini']) {
      renderFocus(session({ agentType }), noop, { defaultSessionView: 'chat' });
      expect(container.querySelector('[data-testid="chat-view"]')).toBeNull();
      expect(container.querySelector('[data-testid="view-pending"]')).toBeNull();
    }
  });

  it('offers no chat for Codex or Gemini sessions, even with a stored choice', () => {
    window.localStorage.setItem('argus.sessionViewMode', JSON.stringify({ s1: 'chat' }));
    for (const agentType of ['codex', 'gemini']) {
      renderFocus(session({ agentType }));
      expect(container.querySelector('[aria-label="Session view"]')).toBeNull();
      expect(container.querySelector('[data-testid="chat-view"]')).toBeNull();
    }
  });
});

describe('Focus — PR diff tool window (B4)', () => {
  const pr = { url: 'https://github.com/o/r/pull/7', pr: null, folderBranch: false, linked: true };
  // The tool window is lazy: let the dynamic import resolve.
  const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });

  it('renders the PR diff full-view over the shell for a maximized prdiff panel', async () => {
    renderFocus(session(), noop, { sidePanel: { kind: 'prdiff', sessionId: 's1', pr, maximized: true } });
    await settle();
    expect(container.querySelector('[data-testid="pr-diff-view"]')?.getAttribute('data-url')).toBe(pr.url);
  });

  it('renders nothing for a prdiff panel of another session', async () => {
    renderFocus(session(), noop, { sidePanel: { kind: 'prdiff', sessionId: 'other', pr, maximized: true } });
    await settle();
    expect(container.querySelector('[data-testid="pr-diff-view"]')).toBeNull();
  });
});
