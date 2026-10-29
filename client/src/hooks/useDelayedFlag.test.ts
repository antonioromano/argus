import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { useDelayedFlag } from './useDelayedFlag.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('useDelayedFlag', () => {
  let container: HTMLDivElement;
  let root: Root;
  let value = false;

  function Probe({ flag, delay }: { flag: boolean; delay?: number }) {
    value = useDelayedFlag(flag, delay);
    return null;
  }
  const render = (flag: boolean, delay?: number) => act(() => { root.render(createElement(Probe, { flag, delay })); });

  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    act(() => { root = createRoot(container); });
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it('stays false until the flag has been on for 300 ms', () => {
    render(true);
    expect(value).toBe(false);
    act(() => { vi.advanceTimersByTime(299); });
    expect(value).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(value).toBe(true);
  });

  it('resets at once when the flag goes false', () => {
    render(true);
    act(() => { vi.advanceTimersByTime(300); });
    expect(value).toBe(true);
    render(false);
    expect(value).toBe(false);
  });

  it('a flag that drops before the delay never shows', () => {
    render(true);
    act(() => { vi.advanceTimersByTime(200); });
    render(false);
    act(() => { vi.advanceTimersByTime(500); });
    expect(value).toBe(false);
  });

  it('honours a custom delay', () => {
    render(true, 50);
    act(() => { vi.advanceTimersByTime(50); });
    expect(value).toBe(true);
  });
});
