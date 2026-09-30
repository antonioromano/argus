import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionInfo } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import { Focus } from './Focus.js';
import { suppress, registerOverlay, resetOverlayRegistryForTests } from '../../hooks/nativeOverlayRegistry.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// Focus keeps a real TerminalShell mounted at all times (see the comment above
// its render), which drags in xterm.js/native-terminal plumbing this test has
// no interest in. Stubbing it isolates the things under test: the "Native"
// marker in Focus's own header and the exited-session card over the terminal.
vi.mock('../ui/TerminalShell.js', () => ({
  TerminalShell: () => null,
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

function renderFocus(active: SessionInfo, onRestart: () => void = noop) {
  act(() => {
    root.render(
      <Focus
        sessions={[active]}
        active={active}
        socket={socket}
        theme="dark"
        sidePanel={null}
        onSelect={noop}
        onReorder={noop}
        onBack={noop}
        onToggleDiff={noop}
        onToggleExplorer={noop}
        onToggleTerminal={noop}
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
