import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionGroup, SessionInfo } from '@argus/shared';
import { SessionTree } from './SessionTree.js';
import { SessionMenuContext, type SessionMenuApi } from './sessionMenuContext.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

const group: SessionGroup = { id: 'g1', name: 'billing', color: 'blue', collapsed: false, sessionIds: [] };

/** Renders the tree inside an ancestor that mimics the sidebar's
 *  click-anywhere-to-collapse handler, so propagation is observable. */
function render() {
  const onToggleCollapsed = vi.fn();
  const onAncestorClick = vi.fn();
  act(() => {
    root.render(
      <div onClick={onAncestorClick}>
        <SessionTree
          grouped={{ favorites: null, groups: [{ group, sessions: [] }], others: [], othersColor: null }}
          activeGroupId={null}
          isDark
          onAssign={vi.fn()}
          onReorderOthers={vi.fn()}
          onToggleCollapsed={onToggleCollapsed}
          onFilterGroup={vi.fn()}
          onCreateGroup={vi.fn()}
          onRenameGroup={vi.fn()}
          onSetColor={vi.fn()}
          onSetOthersColor={vi.fn()}
          onDeleteGroup={vi.fn()}
          onKillGroup={vi.fn()}
          onKillOthers={vi.fn()}
          onOpenSession={vi.fn()}
          onToggleFavorite={vi.fn()}
          onSpawnFromFavorite={vi.fn()}
          isFavorite={() => false}
          onToggleFavoritesCollapsed={vi.fn()}
        />
      </div>,
    );
  });
  return { onToggleCollapsed, onAncestorClick };
}

/** The group header row — the flex row carrying headStyle's density min-height (--group-h). */
function groupHeader(): HTMLElement {
  const row = [...container.querySelectorAll('div')].find((d) => d.style.minHeight === 'var(--group-h)');
  if (!row) throw new Error('group header row not found');
  return row;
}

function click(el: Element) {
  act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
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

describe('SessionTree group header', () => {
  it('toggles the group when the row itself is clicked', () => {
    const { onToggleCollapsed } = render();
    click(groupHeader());
    expect(onToggleCollapsed).toHaveBeenCalledWith('g1');
  });

  it('does not let a row click reach the sidebar collapse handler', () => {
    const { onAncestorClick } = render();
    click(groupHeader());
    expect(onAncestorClick).not.toHaveBeenCalled();
  });

  it('still toggles the group from the chevron button', () => {
    const { onToggleCollapsed } = render();
    const chevron = container.querySelector('button')!;
    click(chevron);
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
    expect(onToggleCollapsed).toHaveBeenCalledWith('g1');
  });
});

describe('SessionTree row — session actions ⋯', () => {
  const s1 = { id: 's1', name: 'alpha', folderPath: '/tmp/alpha', status: 'idle', agentType: 'claude' } as unknown as SessionInfo;

  function renderRow() {
    const openMenuAt = vi.fn();
    const onOpenSession = vi.fn();
    const api: SessionMenuApi = {
      openMenu: vi.fn(), openMenuAt, beginRename: vi.fn(), isRenaming: () => false, commitRename: vi.fn(), cancelRename: vi.fn(),
    };
    act(() => {
      root.render(
        <SessionMenuContext.Provider value={api}>
          <SessionTree
            grouped={{ favorites: null, groups: [], others: [s1], othersColor: null }}
            activeGroupId={null}
            isDark
            onAssign={vi.fn()} onReorderOthers={vi.fn()} onToggleCollapsed={vi.fn()} onFilterGroup={vi.fn()}
            onCreateGroup={vi.fn()} onRenameGroup={vi.fn()} onSetColor={vi.fn()} onSetOthersColor={vi.fn()}
            onDeleteGroup={vi.fn()} onKillGroup={vi.fn()} onKillOthers={vi.fn()}
            onOpenSession={onOpenSession} onToggleFavorite={vi.fn()} onSpawnFromFavorite={vi.fn()}
            isFavorite={() => false} onToggleFavoritesCollapsed={vi.fn()}
          />
        </SessionMenuContext.Provider>,
      );
    });
    const row = container.querySelector('[aria-label="Open alpha"]') as HTMLElement;
    const more = row.querySelector('[aria-label="Session actions"]') as HTMLElement;
    return { openMenuAt, onOpenSession, row, more };
  }

  it('is in the DOM, in its own fixed slot, whether or not the row is hovered', () => {
    const { row, more } = renderRow();
    expect(more).toBeTruthy();
    const slotWidth = () => (more.closest('span') as HTMLElement).style.width;
    expect(slotWidth()).toBe('18px');
    const childCount = row.children.length;
    act(() => { row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    expect(row.children.length).toBe(childCount);
    expect(row.querySelector('[aria-label="Session actions"]')).toBe(more);
    expect(slotWidth()).toBe('18px');
  });

  it('opens the shared menu for the tree surface without opening the session', () => {
    const { more, openMenuAt, onOpenSession } = renderRow();
    click(more);
    expect(openMenuAt).toHaveBeenCalledWith(s1, more, 'tree');
    expect(onOpenSession).not.toHaveBeenCalled();
  });

  it('Enter on the focused ⋯ does not open the session', () => {
    const { more, onOpenSession } = renderRow();
    act(() => { more.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(onOpenSession).not.toHaveBeenCalled();
  });
});
