import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionInfo, SessionPr } from '@argus/shared';
import { MinimizedChip } from './MinimizedChip.js';
import { chipPrSummary, describeChipPrs } from './chipFormat.js';
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

function render(renaming: boolean, s: SessionInfo = session) {
  const onClick = vi.fn();
  act(() => {
    root.render(
      <SessionMenuContext.Provider value={menu(renaming)}>
        <MinimizedChip
          session={s}
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

const PR: SessionPr = {
  number: 42, state: 'open', url: 'https://github.com/o/r/pull/42', ci: 'success', branch: 'feat/x',
  mergeable: 'mergeable', review: 'none', title: 'Add pills',
};

describe('MinimizedChip marks (F5)', () => {
  it('marks uncommitted changes with ± and a tooltip label, after the PR glyph', () => {
    render(false, { ...session, hasGitChanges: true, pr: PR });
    const dirty = container.querySelector('.argus-chip-dirty');
    expect(dirty?.textContent).toBe('±');
    expect(dirty?.getAttribute('aria-label')).toBe('Uncommitted changes');
    const pr = container.querySelector('.argus-chip-pr')!;
    expect(pr.compareDocumentPosition(dirty!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows no ± on a clean tree and no PR glyph without a PR', () => {
    render(false);
    expect(container.querySelector('.argus-chip-dirty')).toBeNull();
    expect(container.querySelector('.argus-chip-pr')).toBeNull();
  });

  it('shows the one header PR, toned, with no count', () => {
    render(false, { ...session, pr: PR });
    const pr = container.querySelector('.argus-chip-pr')!;
    expect(pr.getAttribute('data-tone')).toBe('ready');
    expect(pr.querySelector('.argus-chip-pr-count')).toBeNull();
    expect(pr.getAttribute('aria-label')).toBe('Pull request: o/r#42 · Open, ready to merge — Add pills');
  });

  it('several PRs: the count and the server-picked tone, every PR in the tooltip', () => {
    render(false, {
      ...session,
      pr: PR,
      prSummary: {
        count: 2,
        tone: 'blocked',
        prs: [
          { url: PR.url, number: 42, state: 'open', tone: 'ready' },
          { url: 'https://github.com/o/r/pull/7', number: 7, state: 'open', tone: 'blocked' },
        ],
      },
    });
    const pr = container.querySelector('.argus-chip-pr')!;
    expect(pr.getAttribute('data-tone')).toBe('blocked');
    expect(pr.querySelector('.argus-chip-pr-count')?.textContent).toBe('2');
    expect(pr.getAttribute('aria-label')).toContain('o/r#42');
    expect(pr.getAttribute('aria-label')).toContain('o/r#7 · Open, needs attention');
  });

  it('a closed header PR is not shown', () => {
    expect(chipPrSummary({ ...session, pr: { ...PR, state: 'closed' } })).toBeNull();
    render(false, { ...session, pr: { ...PR, state: 'closed' } });
    expect(container.querySelector('.argus-chip-pr')).toBeNull();
  });

  it('describes merged and draft PRs by state only', () => {
    expect(describeChipPrs({
      count: 2,
      tone: 'draft',
      prs: [
        { url: 'https://github.com/o/r/pull/1', number: 1, state: 'merged', tone: 'merged' },
        { url: 'https://github.com/o/r/pull/2', number: 2, state: 'draft', tone: 'draft' },
      ],
    })).toEqual(['o/r#1 · Merged', 'o/r#2 · Draft']);
  });

  it('sweeps the bottom edge while running, without making the dot pulse', () => {
    render(false, { ...session, status: 'running' });
    const chip = container.querySelector('.argus-chip')!;
    expect(chip.classList.contains('argus-chip--running')).toBe(true);
    expect(chip.querySelector('.argus-tile-prog.argus-chip-prog > i')).not.toBeNull();
  });

  it('has no sweep when not running', () => {
    render(false, { ...session, status: 'waiting' });
    const chip = container.querySelector('.argus-chip')!;
    expect(chip.classList.contains('argus-chip--running')).toBe(false);
    expect(chip.querySelector('.argus-tile-prog')).toBeNull();
  });
});
