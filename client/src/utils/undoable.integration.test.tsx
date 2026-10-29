import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ToastProvider } from '../components/primitives/Toast.js';
import { deferUndoable, offerUndo, runLastUndo } from './undoable.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// The helpers against the real toast: proves the close-reason contract lines up.
describe('undoable + ToastProvider', () => {
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

  const advance = async (ms: number) => {
    for (let t = 0; t < ms; t += 100) await act(async () => { vi.advanceTimersByTime(Math.min(100, ms - t)); });
  };
  const button = (label: string) =>
    Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label)!;

  it('deferred commit: Undo reverts with no commit; timeout commits once', async () => {
    const a = { commit: vi.fn(), revert: vi.fn() };
    act(() => { deferUndoable({ message: 'Deleted A', apply: () => {}, ...a }); });
    await act(async () => button('Undo').click());
    await advance(7000);
    expect(a.revert).toHaveBeenCalledTimes(1);
    expect(a.commit).not.toHaveBeenCalled();

    const b = { commit: vi.fn(), revert: vi.fn() };
    act(() => { deferUndoable({ message: 'Deleted B', apply: () => {}, ...b }); });
    await advance(6500);
    expect(b.commit).toHaveBeenCalledTimes(1);
    expect(b.revert).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Deleted B');
  });

  it('a 4th deferred delete commits the oldest on eviction', async () => {
    const commits: string[] = [];
    act(() => {
      for (const n of ['1', '2', '3', '4']) {
        deferUndoable({ message: `Deleted ${n}`, apply: () => {}, commit: () => { commits.push(n); }, revert: () => {} });
      }
    });
    await act(async () => {});
    expect(commits).toEqual(['1']);
  });

  it('runLastUndo closes the toast without committing', async () => {
    const undo = vi.fn();
    act(() => { offerUndo({ message: 'Settings reset', undo, durationMs: 10_000 }); });
    await act(async () => { runLastUndo(); });
    await advance(300);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain('Settings reset');
  });
});
