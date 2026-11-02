import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Mosaic } from './Mosaic.js';

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
});

const socket = { on: () => {}, off: () => {}, emit: () => {} };

function renderEmpty(extra: { loadError?: string | null; onRetryLoad?: () => void; sessions?: unknown[]; filter?: string; onClearFilter?: () => void }) {
  const noop = () => {};
  const props = {
    sessions: [], onReorder: noop, filter: '', socket, theme: 'dark',
    toggleMinimize: noop, restoreFromFilter: noop, restoreAll: noop, isMinimized: () => false,
    isForeign: () => false, foreignLabel: () => '', onFocusForeign: noop, onOpenSession: noop,
    onTearOff: noop, onCreate: noop, onKill: noop, onRestart: noop, ...extra,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal props for the empty path
  act(() => root.render(<Mosaic {...(props as any)} />));
}

describe('Mosaic with no sessions', () => {
  it('shows the landing when the list loaded empty', () => {
    renderEmpty({ loadError: null });
    expect(container.textContent).toContain('Ready when you are');
  });

  it('shows the load error with Retry instead of the landing when the list failed to load', () => {
    const onRetryLoad = vi.fn();
    renderEmpty({ loadError: 'The Argus server isn’t responding.', onRetryLoad });
    expect(container.textContent).not.toContain('Ready when you are');
    expect(container.textContent).toContain('Couldn’t load your sessions');
    expect(container.textContent).toContain('The Argus server isn’t responding.');
    const retry = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Retry')!;
    act(() => retry.click());
    expect(onRetryLoad).toHaveBeenCalledTimes(1);
  });
});

describe('Mosaic with a filter that matches nothing', () => {
  it('offers Clear filter as its one action', () => {
    const onClearFilter = vi.fn();
    const shell = { id: 's1', name: 'api', folderPath: '/repo', status: 'idle', createdAt: new Date().toISOString(), agentType: 'claude', flags: [] };
    renderEmpty({ sessions: [shell], filter: 'zzz', onClearFilter });
    expect(container.textContent).toContain('Nothing matches "zzz"');
    const clear = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Clear filter')!;
    act(() => clear.click());
    expect(onClearFilter).toHaveBeenCalledTimes(1);
  });
});
