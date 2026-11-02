import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { ToastCloseReason, ToastOptions, ToastTone } from '../components/primitives/Toast.js';

// The toast is the only UI the helpers drive, so a fake that records each push
// and lets the test close it with any reason covers every path deterministically.
interface Pushed {
  message: string;
  tone: ToastTone;
  opts?: ToastOptions;
  dismiss: Mock<() => void>;
}
const pushed: Pushed[] = [];

vi.mock('../components/primitives/Toast.js', () => ({
  pushToast: (message: string, tone: ToastTone = 'ok', opts?: ToastOptions) => {
    const entry: Pushed = {
      message,
      tone,
      opts,
      dismiss: vi.fn(() => { opts?.onClose?.('dismiss'); }),
    };
    // Mirror the real toast: a close reason fires once, whoever triggers it.
    let closed = false;
    const onClose = opts?.onClose;
    if (opts) {
      opts.onClose = (r: ToastCloseReason) => {
        if (closed) return;
        closed = true;
        onClose?.(r);
      };
    }
    pushed.push(entry);
    return { dismiss: entry.dismiss };
  },
}));

const { deferUndoable, offerUndo, peekUndo, runLastUndo, UNDO_WINDOW_SHORT_MS, UNDO_WINDOW_LONG_MS } =
  await import('./undoable.js');

/** What the user does with the toast. `action` = clicks the button (the real toast closes, then runs it). */
async function closeWith(t: Pushed, reason: ToastCloseReason) {
  t.opts!.onClose?.(reason);
  if (reason === 'action') await t.opts!.action!.run();
  await flush();
}
const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const last = () => pushed[pushed.length - 1];

beforeEach(() => {
  pushed.length = 0;
  // Drain any offer a previous test left open.
  while (runLastUndo()) { /* empty */ }
  pushed.length = 0;
});

describe('undo windows', () => {
  it('are 6s for close/list deletes and 10s for git discard, file delete and Reset all', () => {
    expect(UNDO_WINDOW_SHORT_MS).toBe(6000);
    expect(UNDO_WINDOW_LONG_MS).toBe(10_000);
  });
});

describe('deferUndoable', () => {
  const make = (over: Partial<Parameters<typeof deferUndoable>[0]> = {}) => {
    const calls: string[] = [];
    const opts = {
      message: 'Deleted launcher',
      apply: vi.fn(() => { calls.push('apply'); }),
      commit: vi.fn(async () => { calls.push('commit'); }),
      revert: vi.fn(() => { calls.push('revert'); }),
      ...over,
    };
    deferUndoable(opts);
    return { opts, calls };
  };

  it('applies at once and offers an Undo toast with the 6s default', () => {
    const { opts } = make();
    expect(opts.apply).toHaveBeenCalledTimes(1);
    expect(last().message).toBe('Deleted launcher');
    expect(last().tone).toBe('ok');
    expect(last().opts?.action?.label).toBe('Undo');
    expect(last().opts?.durationMs).toBe(6000);
    expect(opts.commit).not.toHaveBeenCalled();
  });

  it('passes a custom duration through', () => {
    make({ durationMs: UNDO_WINDOW_LONG_MS });
    expect(last().opts?.durationMs).toBe(10_000);
  });

  it('Undo reverts and never commits', async () => {
    const { calls } = make();
    await closeWith(last(), 'action');
    expect(calls).toEqual(['apply', 'revert']);
  });

  it.each<ToastCloseReason>(['timeout', 'dismiss', 'evicted'])('%s commits exactly once', async (reason) => {
    const { opts, calls } = make();
    await closeWith(last(), reason);
    last().dismiss();
    await flush();
    expect(opts.commit).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['apply', 'commit']);
  });

  it('a rejected commit reverts and shows a danger toast with the error', async () => {
    const { opts, calls } = make({ commit: vi.fn(async () => { throw new Error('EACCES'); }) });
    await closeWith(pushed[0], 'timeout');
    expect(opts.revert).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['apply', 'revert']);
    expect(last().tone).toBe('danger');
    expect(last().message).toContain('EACCES');
  });

  it('a synchronously throwing commit is handled the same way', async () => {
    const { opts } = make({ commit: vi.fn(() => { throw new Error('boom'); }) });
    await closeWith(pushed[0], 'dismiss');
    expect(opts.revert).toHaveBeenCalledTimes(1);
    expect(last().tone).toBe('danger');
  });

  it('uses failureMessage when given', async () => {
    make({ commit: async () => { throw new Error('nope'); }, failureMessage: 'Couldn’t delete launcher' });
    await closeWith(pushed[0], 'timeout');
    expect(last().message).toBe('Couldn’t delete launcher: nope');
  });

  it('does not push a toast when apply throws', () => {
    expect(() => make({ apply: () => { throw new Error('bad'); } })).toThrow('bad');
    expect(pushed).toHaveLength(0);
  });

  it('the returned handle commits now', async () => {
    const commit = vi.fn(async () => {});
    const handle = deferUndoable({ message: 'x', apply: () => {}, commit, revert: () => {} });
    handle.dismiss();
    await flush();
    expect(commit).toHaveBeenCalledTimes(1);
  });
});

describe('offerUndo', () => {
  it('offers the action after the fact and runs undo on click', async () => {
    const undo = vi.fn(async () => {});
    offerUndo({ message: 'Reverted App.tsx', undo, durationMs: UNDO_WINDOW_LONG_MS });
    expect(last().opts?.action?.label).toBe('Undo');
    expect(last().opts?.durationMs).toBe(10_000);
    await closeWith(last(), 'action');
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('supports a custom label (Reopen)', () => {
    offerUndo({ message: 'Closed demo', actionLabel: 'Reopen', undo: () => {} });
    expect(last().opts?.action?.label).toBe('Reopen');
    expect(last().opts?.durationMs).toBe(6000);
  });

  it.each<ToastCloseReason>(['timeout', 'dismiss', 'evicted'])('%s does nothing', async (reason) => {
    const undo = vi.fn();
    offerUndo({ message: 'x', undo });
    await closeWith(last(), reason);
    expect(undo).not.toHaveBeenCalled();
    expect(pushed).toHaveLength(1);
  });

  it('an undo failure becomes a danger toast', async () => {
    offerUndo({ message: 'Reverted App.tsx', undo: async () => { throw new Error('patch does not apply'); } });
    await closeWith(pushed[0], 'action');
    expect(last().tone).toBe('danger');
    expect(last().message).toContain('patch does not apply');
  });
});

describe('peekUndo / runLastUndo', () => {
  it('peek reports the newest open offer and null once none is open', async () => {
    expect(peekUndo()).toBeNull();
    offerUndo({ message: 'first', undo: () => {} });
    offerUndo({ message: 'second', actionLabel: 'Reopen', undo: () => {} });
    expect(peekUndo()).toEqual({ message: 'second', actionLabel: 'Reopen' });
    await closeWith(pushed[1], 'timeout');
    expect(peekUndo()).toEqual({ message: 'first', actionLabel: 'Undo' });
    await closeWith(pushed[0], 'evicted');
    expect(peekUndo()).toBeNull();
  });

  it('runLastUndo undoes the newest offer, closes its toast, and does not commit', async () => {
    const commit = vi.fn();
    const revert = vi.fn();
    deferUndoable({ message: 'Deleted template', apply: () => {}, commit, revert });
    expect(runLastUndo()).toBe(true);
    await flush();
    expect(revert).toHaveBeenCalledTimes(1);
    expect(pushed[0].dismiss).toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(peekUndo()).toBeNull();
    expect(runLastUndo()).toBe(false);
  });

  it('an offer undone through its toast leaves the stack', async () => {
    const undo = vi.fn();
    offerUndo({ message: 'x', undo });
    await closeWith(last(), 'action');
    expect(peekUndo()).toBeNull();
    expect(runLastUndo()).toBe(false);
    expect(undo).toHaveBeenCalledTimes(1);
  });
});
