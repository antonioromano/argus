/**
 * Captures the current values of `keys` as a patch that restores them exactly.
 * Take it before a bulk write (Reset all, per-pane Reset, removing a custom
 * agent) and hand it to `offerUndo` — see docs/design/feedback-surfaces.md.
 *
 * Values are deep-copied, so edits to the config after the snapshot do not leak
 * into it. Keys the object does not have are omitted from the patch.
 */
export function snapshotKeys<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
  const patch = {} as Pick<T, K>;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) patch[key] = structuredClone(obj[key]);
  }
  return patch;
}
