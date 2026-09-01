import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionInfo } from '@argus/shared';
import { MinimizedChip } from './MinimizedChip.js';
import { SessionMenuContext, type SessionMenuApi } from './sessionMenuContext.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

const session: SessionInfo = {
  id: 's1',
  name: 'billing spike',
  folderPath: '/repo',
  status: 'idle',
  createdAt: new Date().toISOString(),
  agentType: 'claude',
  flags: [],
};

function menu(renaming: boolean): SessionMenuApi {
  return {
    openMenu: () => {},
    beginRename: () => {},
    isRenaming: () => renaming,
    commitRename: () => {},
    cancelRename: () => {},
  };
}

function render(renaming: boolean) {
  const onClick = vi.fn();
  act(() => {
    root.render(
      <SessionMenuContext.Provider value={menu(renaming)}>
        <MinimizedChip
          session={session}
          onClick={onClick}
          onDragStart={() => {}}
          onDragOver={() => {}}
          onDrop={() => {}}
          onDragEnd={() => {}}
          isDropTarget={false}
        />
      </SessionMenuContext.Provider>,
    );
  });
  return { onClick };
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

describe('MinimizedChip', () => {
  it('is a button when it is just a chip', () => {
    render(false);
    expect(container.querySelector('button.argus-chip')).not.toBeNull();
    expect(container.querySelector('input')).toBeNull();
  });

  it('never nests the rename field inside a button', () => {
    // The invariant, asserted structurally rather than by pressing Space: a
    // <button> ancestor activates on Space as a *default action*, which the
    // field's stopPropagation cannot cancel — the chip's onClick fired, the
    // session switched, and the rename died, so a name with a space in it could
    // not be typed at all. jsdom does not reproduce that activation, so a
    // keystroke test would pass against the broken markup. This does not.
    render(true);
    const input = container.querySelector('input');
    expect(input).not.toBeNull();
    expect(input!.closest('button')).toBeNull();
  });

  it('keeps the chip styling and drop target while renaming', () => {
    render(true);
    // The rename branch is a different element, so the class it is styled by has
    // to come with it.
    expect(container.querySelector('.argus-chip')).not.toBeNull();
  });

  it('is not draggable while renaming, so selecting text is not read as a drag', () => {
    // A guard, not a regression test — the old markup got this right too. Asserted
    // on the DOM property so it stays true however the element is expressed.
    render(true);
    const chip = container.querySelector('.argus-chip') as HTMLElement;
    expect(chip.draggable).toBe(false);
  });
});
