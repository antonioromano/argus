import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SkeletonRows } from './SkeletonRows.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('SkeletonRows', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    act(() => { root = createRoot(container); });
  });
  afterEach(() => {
    act(() => root.unmount());
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  const html = () => container.innerHTML;

  it('renders `count` rows of the variant, hidden from assistive tech', () => {
    act(() => { root.render(<SkeletonRows count={4} variant="tree" />); });
    const wrap = container.firstElementChild as HTMLElement;
    expect(wrap.getAttribute('aria-hidden')).toBe('true');
    expect(wrap.classList.contains('argus-skeleton-rows')).toBe(true);
    expect(wrap.dataset.variant).toBe('tree');
    expect(container.querySelectorAll('.argus-skeleton-row')).toHaveLength(4);
  });

  it('widths are deterministic: same props, same markup', () => {
    act(() => { root.render(<SkeletonRows count={6} variant="list" />); });
    const first = html();
    act(() => { root.render(<SkeletonRows count={6} variant="diff" />); });
    act(() => { root.render(<SkeletonRows count={6} variant="list" />); });
    expect(html()).toBe(first);
  });

  it('defaults to a few list rows', () => {
    act(() => { root.render(<SkeletonRows />); });
    expect(container.querySelectorAll('.argus-skeleton-row').length).toBeGreaterThan(0);
    expect((container.firstElementChild as HTMLElement).dataset.variant).toBe('list');
  });
});
