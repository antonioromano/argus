import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ApiError } from '../../../services/api.js';
import { PaneLoadState } from './PaneLoadState.js';

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });

const render = (props: Partial<Parameters<typeof PaneLoadState>[0]> = {}) => {
  const onRetry = vi.fn();
  act(() => root.render(<PaneLoadState loaded={false} error={null} errorTitle="Couldn’t load chains" onRetry={onRetry} {...props} />));
  return onRetry;
};

describe('PaneLoadState', () => {
  it('shows nothing for a fast first load, then a skeleton after 300 ms', () => {
    render();
    expect(container.querySelector('.argus-skeleton-rows')).toBeNull();
    act(() => { vi.advanceTimersByTime(300); });
    expect(container.querySelector('.argus-skeleton-rows')).not.toBeNull();
  });

  it('a failed first load shows the described error, and Retry calls the loader', () => {
    const onRetry = render({ error: new Error('EPIPE') });
    expect(container.textContent).toContain('Couldn’t load chains');
    expect(container.textContent).toContain('EPIPE');
    const retry = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Retry')!;
    act(() => retry.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('a coded error uses its own copy', () => {
    render({ error: new ApiError(0, 'Argus server unreachable', { code: 'SERVER_UNREACHABLE' }) });
    expect(container.textContent).toContain('The Argus server isn’t responding');
  });

  it('a failed reload over a loaded list is a one-line stale notice', () => {
    render({ loaded: true, error: new Error('x') });
    expect(container.querySelector('.argus-stale-notice')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('renders nothing once loaded', () => {
    render({ loaded: true });
    expect(container.innerHTML).toBe('');
  });
});
