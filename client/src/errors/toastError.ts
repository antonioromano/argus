import { pushToast, type ToastHandle } from '../components/primitives/Toast.js';
import { describeError } from './describeError.js';
import { availableActions, errorActionLabel, runErrorAction } from './errorActions.js';

/** Longest server message a toast quotes; the rest is cut with an ellipsis. */
const MAX_REASON = 160;

function shorten(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > MAX_REASON ? `${one.slice(0, MAX_REASON - 1)}…` : one;
}

export interface ToastErrorOptions {
  /** Repeats the failed action; offered as the toast's button when no fix applies. */
  onRetry?: () => void;
}

/**
 * The one way to toast a failure (plan 2026-10-29-003, Unit 8).
 * - A coded error toasts its mapped title and cause, with its first fix
 *   (Copy “brew install gh”, Open Settings → Agents…) as the toast's action.
 * - An uncoded one toasts `fallbackTitle` with the server's reason, shortened:
 *   for validation errors ("branch already exists") that reason is the cause.
 * Never toast `err.message` directly (noRawErrorToasts.test.ts enforces it).
 */
export function toastError(err: unknown, fallbackTitle: string, opts: ToastErrorOptions = {}): ToastHandle {
  const d = describeError(err, { fallbackTitle });
  const reason = d.code ? d.cause : d.detail ? shorten(d.detail) : '';
  const message = reason && reason !== d.title ? `${d.title}: ${reason}` : d.title;

  const ctx = { onRetry: opts.onRetry };
  const runnable = availableActions(d.actions, ctx);
  const action = runnable.find((a) => a.kind !== 'retry') ?? runnable.find((a) => a.kind === 'retry');
  return pushToast(message, 'danger', action ? {
    action: {
      label: errorActionLabel(action),
      run: async () => {
        try {
          const ran = await runErrorAction(action, ctx);
          if (ran && action.kind === 'copy-command') pushToast(`Copied “${action.command}”`, 'ok');
        } catch {
          pushToast('Couldn’t copy to the clipboard', 'warn');
        }
      },
    },
  } : undefined);
}
