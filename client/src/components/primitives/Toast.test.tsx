import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ToastProvider, pushToast, type ToastCloseReason } from './Toast.js';

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
  describe('action toasts', () => {
    const actionButton = (label = 'Undo') =>
      Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label) ?? null;

    it('render a keyboard-reachable action button and a dismiss button', () => {
      act(() => { pushToast('Closed demo', 'ok', { action: { label: 'Undo', run: () => {} } }); });
      const btn = actionButton();
      expect(btn).not.toBeNull();
      expect(btn!.tagName).toBe('BUTTON');
      expect(btn!.tabIndex).not.toBe(-1);
      expect(container.querySelector('button[aria-label="Dismiss"]')).not.toBeNull();
    });

    it('clicking the action runs it and closes with "action", not "timeout"', () => {
      const run = vi.fn();
      const reasons: ToastCloseReason[] = [];
      act(() => { pushToast('Closed demo', 'ok', { action: { label: 'Undo', run }, onClose: (r) => reasons.push(r) }); });
      act(() => actionButton()!.click());
      expect(run).toHaveBeenCalledTimes(1);
      advance(10_000);
      expect(reasons).toEqual(['action']);
      expect(text()).not.toContain('Closed demo');
    });

    it('default to 6s and close with "timeout"', () => {
      const onClose = vi.fn();
      act(() => { pushToast('Closed demo', 'ok', { action: { label: 'Undo', run: () => {} }, onClose }); });
      advance(5500);
      expect(text()).toContain('Closed demo');
      expect(onClose).not.toHaveBeenCalled();
      advance(1000);
      expect(onClose).toHaveBeenCalledExactlyOnceWith('timeout');
      expect(text()).not.toContain('Closed demo');
    });

    it('honour a per-toast duration', () => {
      const onClose = vi.fn();
      act(() => { pushToast('Reverted file', 'ok', { action: { label: 'Undo', run: () => {} }, durationMs: 10_000, onClose }); });
      advance(9000);
      expect(onClose).not.toHaveBeenCalled();
      advance(1500);
      expect(onClose).toHaveBeenCalledExactlyOnceWith('timeout');
    });

    it('pause while hovered and restart the full duration on leave', () => {
      const onClose = vi.fn();
      act(() => { pushToast('Closed demo', 'ok', { action: { label: 'Undo', run: () => {} }, onClose }); });
      const el = container.querySelector('[role="status"] > div')!;
      advance(4000);
      act(() => { el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
      advance(20_000);
      expect(onClose).not.toHaveBeenCalled();
      act(() => { el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); });
      advance(5500);
      expect(onClose).not.toHaveBeenCalled();
      advance(1000);
      expect(onClose).toHaveBeenCalledExactlyOnceWith('timeout');
    });

    it('pause while focused', () => {
      const onClose = vi.fn();
      act(() => { pushToast('Closed demo', 'ok', { action: { label: 'Undo', run: () => {} }, onClose }); });
      act(() => actionButton()!.focus());
      advance(20_000);
      expect(onClose).not.toHaveBeenCalled();
    });

    it('the dismiss button closes with "dismiss"', () => {
      const onClose = vi.fn();
      act(() => { pushToast('Closed demo', 'ok', { action: { label: 'Undo', run: () => {} }, onClose }); });
      act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')!.click());
      advance(300);
      expect(onClose).toHaveBeenCalledExactlyOnceWith('dismiss');
      expect(text()).not.toContain('Closed demo');
    });

    it('the returned handle dismisses the toast with "dismiss"', () => {
      const onClose = vi.fn();
      let handle!: ReturnType<typeof pushToast>;
      act(() => { handle = pushToast('Closed demo', 'ok', { action: { label: 'Undo', run: () => {} }, onClose }); });
      act(() => handle.dismiss());
      act(() => handle.dismiss());
      advance(300);
      expect(onClose).toHaveBeenCalledExactlyOnceWith('dismiss');
      expect(text()).not.toContain('Closed demo');
    });

    it('cap at 3: a 4th action toast evicts the oldest with "evicted"', () => {
      const closes: Array<[string, ToastCloseReason]> = [];
      const push = (name: string) => pushToast(name, 'ok', {
        action: { label: 'Undo', run: () => {} },
        onClose: (r) => closes.push([name, r]),
      });
      act(() => { push('one'); push('two'); push('three'); });
      expect(closes).toEqual([]);
      act(() => { push('four'); });
      expect(closes).toEqual([['one', 'evicted']]);
      advance(300);
      expect(text()).not.toContain('one');
      expect(text()).toContain('two');
      expect(text()).toContain('four');
    });

    it('plain toasts do not count toward the action cap', () => {
      const onClose = vi.fn();
      act(() => {
        pushToast('a', 'ok', { action: { label: 'Undo', run: () => {} }, onClose });
        pushToast('plain-1', 'ok');
        pushToast('plain-2', 'warn');
        pushToast('b', 'ok', { action: { label: 'Undo', run: () => {} } });
        pushToast('c', 'ok', { action: { label: 'Undo', run: () => {} } });
      });
      expect(onClose).not.toHaveBeenCalled();
    });

    it('onClose never fires twice, and provider unmount closes open toasts as "dismiss"', () => {
      const a = vi.fn();
      const b = vi.fn();
      act(() => {
        pushToast('a', 'ok', { action: { label: 'Undo', run: () => {} }, onClose: a });
        pushToast('b', 'ok', { action: { label: 'Undo', run: () => {} }, onClose: b });
      });
      act(() => actionButton()!.click()); // closes 'a' with 'action'
      act(() => root.unmount());
      expect(a).toHaveBeenCalledExactlyOnceWith('action');
      expect(b).toHaveBeenCalledExactlyOnceWith('dismiss');
      // Re-mount so afterEach's unmount has something to tear down.
      act(() => { root = createRoot(container); });
      vi.runAllTimers();
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
    });

    it('a toast with an action is dismissible even when tone is ok', () => {
      act(() => { pushToast('Closed demo', 'ok', { action: { label: 'Reopen', run: () => {} } }); });
      expect(actionButton('Reopen')).not.toBeNull();
      expect(container.querySelector('button[aria-label="Dismiss"]')).not.toBeNull();
    });
  });

  it('a plain ok toast honours durationMs and reports "timeout"', () => {
    const onClose = vi.fn();
    act(() => { pushToast('Copied', 'ok', { durationMs: 4000, onClose }); });
    advance(3000);
    expect(text()).toContain('Copied');
    advance(1500);
    expect(onClose).toHaveBeenCalledExactlyOnceWith('timeout');
  });
});

describe('pushToast without a provider', () => {
  it('closes immediately as "dismiss" so deferred commits are not stranded', () => {
    const onClose = vi.fn();
    const handle = pushToast('x', 'ok', { action: { label: 'Undo', run: () => {} }, onClose });
    expect(onClose).toHaveBeenCalledExactlyOnceWith('dismiss');
    handle.dismiss();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
