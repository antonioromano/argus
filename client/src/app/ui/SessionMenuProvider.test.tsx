import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionInfo } from '@argus/shared';
import { SessionMenuProvider } from './SessionMenuProvider.js';
import { useSessionMenu, type SessionSurface } from './sessionMenuContext.js';
import { SessionRenameInput } from './SessionRenameInput.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const session = {
  id: 's1',
  name: 'alpha',
  folderPath: '/tmp/alpha',
  status: 'idle',
  agentType: 'claude',
} as unknown as SessionInfo;

/** Stand-in for a real surface (tile header, sidebar row, chip): shows the name,
 *  right-click opens the shared menu, and it flips to an input while renaming. */
function Surface({ surface }: { surface: SessionSurface }) {
  const menu = useSessionMenu();
  return menu.isRenaming(session.id, surface) ? (
    <SessionRenameInput
      initial="alpha"
      onCommit={(v) => menu.commitRename(session.id, v)}
      onCancel={menu.cancelRename}
    />
  ) : (
    <span data-surface={surface} onContextMenu={(e) => menu.openMenu(session, e, surface)}>
      alpha
    </span>
  );
}

let container: HTMLDivElement;
let root: Root;

function mount(onRename = vi.fn()) {
  act(() => {
    root.render(
      <SessionMenuProvider
        actions={{ onOpen: vi.fn(), onKill: vi.fn(), onRestart: vi.fn() }}
        onRename={onRename}
      >
        <div data-testid="tile"><Surface surface="tile" /></div>
        <div data-testid="tree"><Surface surface="tree" /></div>
      </SessionMenuProvider>,
    );
  });
  return { onRename };
}

function openMenuOn(surface: SessionSurface) {
  const el = container.querySelector(`[data-surface="${surface}"]`)!;
  act(() => {
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
  });
}

function clickMenuItem(label: string) {
  const item = (Array.from(document.querySelectorAll('[role="menuitem"]')) as HTMLElement[])
    .find((i) => i.textContent?.includes(label));
  expect(item, `menu item ${label}`).toBeTruthy();
  act(() => {
    // Real browsers focus a button before the click fires.
    item!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    item!.focus();
    item!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
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
});

describe('SessionMenuProvider rename', () => {
  it('opens exactly one editor, on the surface the menu came from', () => {
    mount();
    openMenuOn('tile');
    clickMenuItem('Rename shell');

    const inputs = container.querySelectorAll('input');
    expect(inputs.length, 'one editor, not one per surface').toBe(1);
    expect(container.querySelector('[data-testid="tile"] input')).toBeTruthy();
    expect(container.querySelector('[data-testid="tree"] input')).toBeNull();
    // A second editor autofocusing would blur (and so cancel) the first.
    expect(document.activeElement).toBe(inputs[0]);
  });

  it('editor started from the sidebar row stays on the sidebar row', () => {
    mount();
    openMenuOn('tree');
    clickMenuItem('Rename shell');

    expect(container.querySelectorAll('input').length).toBe(1);
    expect(container.querySelector('[data-testid="tree"] input')).toBeTruthy();
  });

  it('commits the edited name once', () => {
    const { onRename } = mount();
    openMenuOn('tile');
    clickMenuItem('Rename shell');

    const input = container.querySelector('input')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, 'renamed');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });

    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith('s1', 'renamed');
    expect(container.querySelector('input')).toBeNull();
  });
});
