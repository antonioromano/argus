/* eslint-disable @typescript-eslint/no-explicit-any -- window/global test shims for the electron bridge + React act environment */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useNativeOverlayRect } from './useNativeOverlayRect.js';

const api = { attach: vi.fn(), setRect: vi.fn(), detach: vi.fn(), available: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  (window as any).electronNativeTerminal = api;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

function Probe({ enabled }: { enabled: boolean }) {
  const ref = useNativeOverlayRect('s1', enabled);
  return <div ref={ref} data-testid="hole" />;
}

describe('useNativeOverlayRect', () => {
  it('attaches with the hole rect when enabled', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    act(() => root.render(<Probe enabled />));
    expect(api.attach).toHaveBeenCalledTimes(1);
    expect(api.attach.mock.calls[0][0]).toBe('s1');
    act(() => root.unmount());
  });

  it('does nothing at all when disabled — the web path must be untouched', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    act(() => root.render(<Probe enabled={false} />));
    expect(api.attach).not.toHaveBeenCalled();
    expect(api.setRect).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it('detaches on unmount so the overlay cannot outlive its tile', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    act(() => root.render(<Probe enabled />));
    act(() => root.unmount());
    expect(api.detach).toHaveBeenCalledWith('s1');
  });
});
