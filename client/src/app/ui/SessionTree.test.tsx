import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionGroup } from '@argus/shared';
import { SessionTree } from './SessionTree.js';

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

/** The group header row — the flex row carrying headStyle's 26px min-height. */
function groupHeader(): HTMLElement {
  const row = [...container.querySelectorAll('div')].find((d) => d.style.minHeight === '26px');
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
