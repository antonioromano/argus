import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionPr } from '@argus/shared';
import { PrChip } from './PrChip.js';
import { describePr } from '../../utils/prFormat.js';

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
  delete (window as Window & { electronShell?: unknown }).electronShell;
});

const pr: SessionPr = { number: 42, state: 'open', url: 'https://github.com/o/r/pull/42', ci: 'failure', branch: 'feat/x' };

describe('PrChip', () => {
  it('shows the number, the state and the CI verdict', () => {
    act(() => root.render(<PrChip pr={pr} />));
    const chip = container.querySelector('[data-testid="pr-chip"]')!;
    expect(chip.textContent).toBe('#42');
    expect(chip.getAttribute('data-state')).toBe('open');
    expect(container.querySelector('.argus-pr-ci')!.getAttribute('data-ci')).toBe('failure');
    expect(chip.getAttribute('aria-label')).toBe('Open PR #42 · checks failing — click to open on GitHub');
  });

  it('hides the CI dot for a merged PR and when there are no checks', () => {
    act(() => root.render(<PrChip pr={{ ...pr, state: 'merged' }} />));
    expect(container.querySelector('[data-testid="pr-chip"]')!.getAttribute('data-state')).toBe('merged');
    expect(container.querySelector('.argus-pr-ci')).toBeNull();
    act(() => root.render(<PrChip pr={{ ...pr, ci: 'none' }} />));
    expect(container.querySelector('.argus-pr-ci')).toBeNull();
  });

  it('opens the PR through the external-link bridge without bubbling', () => {
    const openExternal = vi.fn();
    (window as Window & { electronShell?: unknown }).electronShell = { openExternal };
    const onParent = vi.fn();
    act(() => root.render(<div onClick={onParent}><PrChip pr={pr} /></div>));
    act(() => (container.querySelector('[data-testid="pr-chip"]') as HTMLButtonElement).click());
    expect(openExternal).toHaveBeenCalledWith(pr.url);
    expect(onParent).not.toHaveBeenCalled();
  });

  it('describes drafts and pending checks', () => {
    expect(describePr({ ...pr, state: 'draft', ci: 'pending' })).toBe('Draft PR #42 · checks running — click to open on GitHub');
  });
});
