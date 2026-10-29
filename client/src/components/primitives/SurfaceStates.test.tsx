import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SurfaceStates } from './SurfaceStates.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('SurfaceStates', () => {
  let container: HTMLDivElement;
  let root: Root;
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

  const text = () => container.textContent ?? '';
  const skeleton = <div className="skel">SKELETON</div>;

  it('renders nothing for the first 300 ms of loading, then the skeleton', () => {
    act(() => { root.render(<SurfaceStates state="loading" skeleton={skeleton} empty="Nothing">DATA</SurfaceStates>); });
    expect(text()).toBe('');
    act(() => { vi.advanceTimersByTime(299); });
    expect(text()).toBe('');
    act(() => { vi.advanceTimersByTime(1); });
    expect(text()).toBe('SKELETON');
  });

  it('empty renders the empty slot; ready renders children', () => {
    act(() => { root.render(<SurfaceStates state="empty" skeleton={skeleton} empty="Nothing here.">DATA</SurfaceStates>); });
    expect(text()).toBe('Nothing here.');
    act(() => { root.render(<SurfaceStates state="ready" skeleton={skeleton} empty="Nothing here.">DATA</SurfaceStates>); });
    expect(text()).toBe('DATA');
  });

  it('error renders an ErrorState for the error, with Retry wired', () => {
    const onRetry = vi.fn();
    act(() => { root.render(<SurfaceStates state="error" error={new Error('boom')} errorTitle="Couldn’t load activity" onRetry={onRetry} skeleton={skeleton}>DATA</SurfaceStates>); });
    expect(text()).toMatch(/Couldn’t load activity/);
    expect(text()).not.toMatch(/DATA/);
    const retry = [...container.querySelectorAll('button')].find((b) => /Retry/.test(b.textContent ?? ''));
    act(() => { retry!.click(); });
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('a coded error keeps its own title over errorTitle', () => {
    const coded = Object.assign(new Error('x'), { code: 'GH_TIMEOUT' });
    act(() => { root.render(<SurfaceStates state="error" error={coded} errorTitle="Couldn’t load" skeleton={skeleton}>DATA</SurfaceStates>); });
    expect(text()).toMatch(/GitHub took too long/);
  });

  it('stale keeps the data and adds the notice above it', () => {
    act(() => { root.render(<SurfaceStates state="stale" error={new Error('x')} onRetry={() => {}} skeleton={skeleton}>DATA</SurfaceStates>); });
    const notice = container.querySelector('.argus-stale-notice');
    expect(notice).toBeTruthy();
    expect(text()).toMatch(/DATA$/);
  });

  it('a custom error slot replaces the default ErrorState', () => {
    act(() => { root.render(<SurfaceStates state="error" errorSlot={<span>CUSTOM</span>} skeleton={skeleton}>DATA</SurfaceStates>); });
    expect(text()).toBe('CUSTOM');
  });
});
