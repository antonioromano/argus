import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { KeepAwakeStatus } from '@argus/shared';
import { KeepAwakeButton } from './KeepAwakeButton.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const MOUNT_AT = 1_700_000_000_000;

let container: HTMLDivElement;
let root: Root;
let clock: number;

/** The countdown text inside the armed pill (the pill's only <span>). */
function pillText(): string | null {
  return container.querySelector('button span')?.textContent ?? null;
}

function render(status: KeepAwakeStatus | null) {
  act(() => {
    root.render(<KeepAwakeButton status={status} onArm={() => {}} onDisarm={() => {}} />);
  });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  clock = MOUNT_AT;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
});

describe('KeepAwakeButton countdown', () => {
  it('shows the chosen window on first paint, not window + app uptime', () => {
    // Toolbar mounts, then sits idle for three hours. Nothing ticks the clock
    // while disarmed, so the component's `now` is three hours stale by the time
    // the user arms — the regression this guards read "3:05:00" for a 5m window.
    render({ active: false, expiresAt: null, indefinite: false });
    clock = MOUNT_AT + 3 * 60 * 60_000;

    render({ active: true, expiresAt: clock + 5 * 60_000, indefinite: false });

    expect(pillText()).toBe('5:00');
  });

  it('reseeds when a second window is armed after a long idle gap', () => {
    render({ active: true, expiresAt: MOUNT_AT + 5 * 60_000, indefinite: false });
    render({ active: false, expiresAt: null, indefinite: false });

    clock = MOUNT_AT + 2 * 60 * 60_000;
    render({ active: true, expiresAt: clock + 30 * 60_000, indefinite: false });

    expect(pillText()).toBe('30:00');
  });

  it('counts down as the clock advances', () => {
    // Only the interval is faked: `Date.now` stays on the spy above so the test
    // controls the wall clock and the tick independently.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      render({ active: true, expiresAt: MOUNT_AT + 60_000, indefinite: false });
      expect(pillText()).toBe('1:00');

      clock = MOUNT_AT + 15_000;
      act(() => { vi.advanceTimersByTime(1000); });

      expect(pillText()).toBe('0:45');
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders ∞ for an indefinite window', () => {
    render({ active: true, expiresAt: null, indefinite: true });
    expect(pillText()).toBe('∞');
  });

  it('renders no countdown while disarmed', () => {
    render({ active: false, expiresAt: null, indefinite: false });
    expect(pillText()).toBeNull();
  });
});
