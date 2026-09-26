/**
 * Ordering helpers for drag-and-drop over a list of session ids.
 *
 * Both the sidebar's groups (ordered by `SessionGroup.sessionIds`) and its
 * Others bucket (ordered by the global session order) reposition the same way,
 * so the rule lives here once rather than three times.
 */

/**
 * Which id the dragged row should land in front of, given the row it was
 * dropped on and which half of that row the cursor was in. Null means "append":
 * dropping below the last row leaves nothing for it to precede.
 */
export function insertionPoint(
  ids: string[],
  targetId: string,
  edge: 'top' | 'bottom',
): string | null {
  if (edge === 'top') return targetId;
  const idx = ids.indexOf(targetId);
  if (idx === -1) return null;
  return ids[idx + 1] ?? null;
}

/**
 * Move `moving` to sit directly before `beforeId`, or to the end when that is
 * null or not present.
 *
 * The removal happens before the insertion point is looked up, which is what
 * makes dragging a row *downward* inside its own list land where the cursor is
 * rather than one row short of it.
 */
export function insertBefore(ids: string[], moving: string, beforeId: string | null): string[] {
  // Asked to put a row before itself, leave the list alone. Falling through
  // would remove it, fail to find its own id, and silently append it to the end.
  if (beforeId === moving) return ids;
  const without = ids.filter((id) => id !== moving);
  const at = beforeId ? without.indexOf(beforeId) : -1;
  if (at === -1) return [...without, moving];
  return [...without.slice(0, at), moving, ...without.slice(at)];
}
