import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ToastProvider, pushToast } from './Toast.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('Toast', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => { root = createRoot(container); });
    act(() => { root.render(<ToastProvider><div /></ToastProvider>); });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
    vi.useRealTimers();
  });

  const text = () => container.textContent ?? '';
  // Step in small slices so timers armed by effects after a commit (the fade-out
  // timer is armed once the auto-dismiss fires) also run inside the window.
  const advance = (ms: number) => {
    for (let t = 0; t < ms; t += 100) act(() => { vi.advanceTimersByTime(Math.min(100, ms - t)); });
  };

  it('ok toasts stay brief (unchanged)', () => {
    act(() => pushToast('Saved', 'ok'));
    expect(text()).toContain('Saved');
    advance(1800);
    expect(text()).not.toContain('Saved');
  });

  it('danger toasts stay readable for ~6s and are announced assertively', () => {
    act(() => pushToast('Save failed: EACCES', 'danger'));
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Save failed: EACCES');
    advance(3000);
    expect(text()).toContain('Save failed: EACCES');
    advance(3500);
    expect(text()).not.toContain('Save failed: EACCES');
  });

  it('danger toasts can be dismissed with a close button', () => {
    act(() => pushToast('Boom', 'danger'));
    const close = container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]');
    expect(close).not.toBeNull();
    act(() => close!.click());
    advance(300); // fade-out
    expect(text()).not.toContain('Boom');
  });

  it('hovering a danger toast pauses its timeout', () => {
    act(() => pushToast('Hold on', 'danger'));
    const el = container.querySelector('[role="alert"] > div')!;
    act(() => { el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    advance(10_000);
    expect(text()).toContain('Hold on');
    act(() => { el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); });
    advance(6500);
    expect(text()).not.toContain('Hold on');
  });

  it('non-danger toasts are not in the alert region', () => {
    act(() => pushToast('Heads up', 'warn'));
    expect(container.querySelector('[role="alert"]')?.textContent ?? '').not.toContain('Heads up');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Heads up');
  });
});
