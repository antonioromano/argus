import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QuickActionPicker } from './QuickActionPicker.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // Stand-in for the settings card: clips anything positioned inside it.
  container = document.createElement('div');
  container.style.overflow = 'hidden';
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('QuickActionPicker', () => {
  it('renders the list outside the clipping container and still selects on click', () => {
    const onChange = vi.fn();
    act(() => root.render(<QuickActionPicker value="diff" onChange={onChange} defaultAction="diff" />));
    act(() => container.querySelector<HTMLButtonElement>('button[aria-haspopup]')!.click());

    const list = document.querySelector('[role="listbox"]')!;
    expect(list).not.toBeNull();
    expect(container.contains(list)).toBe(false);
    expect((list as HTMLElement).style.position).toBe('fixed');
    expect((list as HTMLElement).style.visibility).toBe('visible');
    // Above the Settings sheet it opens from, not the in-page popover layer.
    expect((list as HTMLElement).style.zIndex).toBe('var(--z-popover)');

    // A real click starts with mousedown — the outside-click guard must not
    // close the list before the option's click lands.
    const option = list.querySelectorAll<HTMLButtonElement>('[role="option"]')[1];
    act(() => {
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      option.click();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it('closes on a click outside', () => {
    act(() => root.render(<QuickActionPicker value="diff" onChange={() => {}} defaultAction="diff" />));
    act(() => container.querySelector<HTMLButtonElement>('button[aria-haspopup]')!.click());
    act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });
});
