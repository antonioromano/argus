/**
 * Undo for destructive actions. Two mechanisms, both driven by an action toast
 * (policy: docs/design/feedback-surfaces.md):
 *
 * - `deferUndoable` — **deferred commit.** `apply()` hides the thing now, the
 *   real delete (`commit`) runs when the toast closes for any reason except its
 *   Undo button, and Undo calls `revert()` instead. For deletes the server can't
 *   honestly reverse (launchers, templates, chains, rules, closing an exited
 *   session).
 * - `offerUndo` — **snapshot restore.** The action has already happened; the
 *   toast offers `undo()`, which restores from a snapshot the caller captured
 *   (git discard `undoId`, staged trash, `snapshotKeys` for config). Pass
 *   `actionLabel: 'Reopen'` when the restore is only partial (a closed live
 *   session's conversation) — never label a partial restore "Undo".
 *
 * Unload: a deferred commit still pending when the window unloads is **not**
 * flushed. The deleted thing survives the reload, which is the fail-safe
 * direction. Provider unmount, by contrast, closes toasts as `dismiss`, which
 * commits.
 *
 * `peekUndo` / `runLastUndo` expose the newest open offer for a palette entry
 * ("Undo <last action>"). There is deliberately no global ⌘Z: the terminal,
 * Monaco and text inputs own it.
 */
import { pushToast, type ToastHandle } from '../components/primitives/Toast.js';

/** Closing a session, deleting a list row or group. */
export const UNDO_WINDOW_SHORT_MS = 6000;
/** Git discard, Explorer file delete, Reset all. */
export const UNDO_WINDOW_LONG_MS = 10_000;

export interface UndoOffer {
  message: string;
  actionLabel: string;
}

interface OpenOffer extends UndoOffer {
  undo: () => void;
}

/** Open offers, oldest first. */
const open: OpenOffer[] = [];

function leave(offer: OpenOffer) {
  const i = open.indexOf(offer);
  if (i !== -1) open.splice(i, 1);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Runs `fn`, sync or async, and routes any failure to `onError`. */
function attempt(fn: () => void | Promise<void>, onError: (err: unknown) => void): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .catch(onError);
}

/** Newest open undo offer, or null. */
export function peekUndo(): UndoOffer | null {
  const top = open[open.length - 1];
  return top ? { message: top.message, actionLabel: top.actionLabel } : null;
}

/** Runs the newest open undo offer and closes its toast. False when there is none. */
export function runLastUndo(): boolean {
  const top = open[open.length - 1];
  if (!top) return false;
  top.undo();
  return true;
}

export interface DeferUndoableOptions {
  /** Toast text, past tense: "Deleted launcher", "Closed api-server". */
  message: string;
  /** Optimistic local change (hide the row/tile). Runs synchronously; if it throws, nothing is offered. */
  apply: () => void;
  /** The real, irreversible change. Runs once the toast closes without Undo. */
  commit: () => void | Promise<void>;
  /** Undo `apply`. Also runs when `commit` fails. */
  revert: () => void;
  durationMs?: number;
  /** Prefix for the danger toast when `commit` fails; the error text is appended. */
  failureMessage?: string;
}

export function deferUndoable(opts: DeferUndoableOptions): ToastHandle {
  const { message, apply, commit, revert, durationMs = UNDO_WINDOW_SHORT_MS } = opts;
  const failurePrefix = opts.failureMessage ?? `Couldn’t finish “${message}”, so it was undone`;
  apply();

  let settled = false;
  let handle: ToastHandle | null = null;
  const settle = () => {
    if (settled) return false;
    settled = true;
    leave(offer);
    return true;
  };
  const reportRevertFailure = (err: unknown) => pushToast(`Couldn’t undo: ${errorText(err)}`, 'danger');

  const offer: OpenOffer = {
    message,
    actionLabel: 'Undo',
    undo: () => {
      if (!settle()) return;
      handle?.dismiss();
      void attempt(revert, reportRevertFailure);
    },
  };
  open.push(offer);

  handle = pushToast(message, 'ok', {
    action: { label: 'Undo', run: offer.undo },
    durationMs,
    onClose: (reason) => {
      if (reason === 'action') return; // the action's run() reverts
      if (!settle()) return;
      void attempt(commit, (err) => {
        void attempt(revert, reportRevertFailure);
        pushToast(`${failurePrefix}: ${errorText(err)}`, 'danger');
      });
    },
  });
  return handle;
}

export interface OfferUndoOptions {
  /** Toast text, past tense: "Reverted App.tsx", "Settings reset". */
  message: string;
  /** Restores from the caller's snapshot. A failure becomes a danger toast. */
  undo: () => void | Promise<void>;
  /** "Undo" for an exact restore; "Reopen" for a partial one. */
  actionLabel?: string;
  durationMs?: number;
}

export function offerUndo(opts: OfferUndoOptions): ToastHandle {
  const { message, undo, actionLabel = 'Undo', durationMs = UNDO_WINDOW_SHORT_MS } = opts;

  let settled = false;
  let handle: ToastHandle | null = null;
  const settle = () => {
    if (settled) return false;
    settled = true;
    leave(offer);
    return true;
  };

  const offer: OpenOffer = {
    message,
    actionLabel,
    undo: () => {
      if (!settle()) return;
      handle?.dismiss();
      void attempt(undo, (err) => {
        pushToast(`Couldn’t ${actionLabel.toLowerCase()}: ${errorText(err)}`, 'danger');
      });
    },
  };
  open.push(offer);

  handle = pushToast(message, 'ok', {
    action: { label: actionLabel, run: offer.undo },
    durationMs,
    onClose: (reason) => {
      if (reason !== 'action') settle();
    },
  });
  return handle;
}
