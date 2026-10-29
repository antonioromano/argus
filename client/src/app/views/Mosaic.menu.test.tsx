import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionInfo } from '@argus/shared';
import { Mosaic } from './Mosaic.js';
import { SessionMenuProvider } from '../ui/SessionMenuProvider.js';

// The terminal is irrelevant to the header menu and needs a real canvas/socket.
vi.mock('../ui/TerminalShell.js', () => ({ TerminalShell: () => null }));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

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

const socket = { on: () => {}, off: () => {}, emit: () => {} };
const session = {
  id: 's1', name: 'alpha', folderPath: '/tmp/alpha', status: 'idle', agentType: 'claude',
  createdAt: 0, hasGitChanges: false,
} as unknown as SessionInfo;

function render() {
  const noop = () => {};
  const props = {
    sessions: [session], onReorder: noop, filter: '', socket, theme: 'dark',
    toggleMinimize: noop, restoreFromFilter: noop, restoreAll: noop, isMinimized: () => false,
    isForeign: () => false, foreignLabel: () => '', onFocusForeign: noop, onOpenSession: noop,
    onTearOff: noop, onCreate: noop, onKill: noop, onRestart: noop,
  };
  act(() => root.render(
    <SessionMenuProvider
      actions={{
        onOpen: vi.fn(), onKill: vi.fn(), onRestart: vi.fn(),
        onToggleMinimize: vi.fn(), onMarkDone: vi.fn(), canMarkDone: () => true,
      }}
      onRename={vi.fn()}
    >
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal props for one tile */}
      <Mosaic {...(props as any)} />
    </SessionMenuProvider>,
  ));
}

const menuIds = () =>
  [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((b) => b.textContent);

describe('Mosaic tile ⋯', () => {
  it('opens the one shared session menu, same entries as right-clicking the name', () => {
    render();
    const more = container.querySelector('[aria-label="Session actions"]') as HTMLElement;
    expect(more).toBeTruthy();
    act(() => more.click());
    expect(document.querySelectorAll('[role="menu"]').length).toBe(1);
    const fromButton = menuIds();
    expect(fromButton.some((t) => t?.includes('Minimize'))).toBe(true);
    expect(fromButton.some((t) => t?.includes('Mark as done'))).toBe(true);

    act(() => more.click()); // toggles closed
    expect(document.querySelectorAll('[role="menu"]').length).toBe(0);

    const name = container.querySelector('.argus-tile-name')!;
    act(() => { name.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 })); });
    expect(menuIds()).toEqual(fromButton);
  });
});
