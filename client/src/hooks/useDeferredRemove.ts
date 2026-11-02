import { useCallback, useState } from 'react';
import { deferUndoable } from '../utils/undoable.js';

export interface DeferredRemoveOptions {
  /** Toast text, past tense: "Deleted JarvAR refresh". */
  message: string;
  /** The real delete. Throw (or reject) to bring the row back with an error toast. */
  commit: () => void | Promise<void>;
  /** Runs after a successful commit, e.g. to refetch the list. */
  onCommitted?: () => void;
}

/**
 * Deferred delete for a list row (launchers, templates, chains, auto-approval
 * rules — docs/design/feedback-surfaces.md): the row hides at once, the real
 * delete runs when the 6 s Undo toast closes, and Undo shows it again with no
 * request made. Render `list.filter((x) => !hidden.has(x.id))`.
 */
export function useDeferredRemove() {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());

  const show = useCallback((id: string) => {
    setHidden((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const remove = useCallback((id: string, { message, commit, onCommitted }: DeferredRemoveOptions) => {
    deferUndoable({
      message,
      apply: () => setHidden((prev) => (prev.has(id) ? prev : new Set(prev).add(id))),
      commit: async () => {
        await commit();
        onCommitted?.();
      },
      revert: () => show(id),
    });
  }, [show]);

  return { hidden, remove };
}
