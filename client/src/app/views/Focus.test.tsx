import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionInfo } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import { Focus } from './Focus.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// Focus keeps a real TerminalShell mounted at all times (see the comment above
// its render), which drags in xterm.js/native-terminal plumbing this test has
// no interest in. Stubbing it isolates the thing under test: the "Direct"
// marker in Focus's own header, next to the copy-path label.
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

function renderFocus(active: SessionInfo) {
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
        onRestart={noop}
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

describe('Focus header — Direct marker', () => {
  it('renders the "Direct" marker for a direct session', () => {
    renderFocus(session({ runMode: 'direct' }));
    const marker = Array.from(container.querySelectorAll('.argus-tile-branch'))
      .find((el) => el.textContent === 'Direct');
    expect(marker).toBeDefined();
  });

  it('does not render the "Direct" marker for a persistent session', () => {
    renderFocus(session({ runMode: 'persistent' }));
    const marker = Array.from(container.querySelectorAll('.argus-tile-branch'))
      .find((el) => el.textContent === 'Direct');
    expect(marker).toBeUndefined();
  });
});
