// Reference counts for Monaco text models, keyed by file path.
//
// @monaco-editor/react keys a model by its `path` (one model per URI) and, unless
// `keepCurrentModel` is set, disposes that model when its <Editor> unmounts. The
// split editor can show the same file in both groups — two <Editor>s on ONE model —
// so closing the tab in one group disposed the model under the other, which went
// blank and stopped reporting edits. MonacoPane passes keepCurrentModel and
// manages lifetime here instead: the model is disposed only when the last editor
// showing that path lets go.

const counts = new Map<string, number>();

export function retainModel(path: string): void {
  counts.set(path, (counts.get(path) ?? 0) + 1);
}

/**
 * Drop one reference. When none remain, `dispose` runs on the next task (via
 * `defer`) unless something re-retained the path in between — a remount of the
 * same file (e.g. the edit ↔ split view toggle) keeps its model and undo history.
 */
export function releaseModel(
  path: string,
  dispose: () => void,
  defer: (fn: () => void) => void = (fn) => { setTimeout(fn, 0); },
): void {
  const n = (counts.get(path) ?? 0) - 1;
  if (n > 0) {
    counts.set(path, n);
    return;
  }
  counts.delete(path);
  defer(() => {
    if (!counts.has(path)) dispose();
  });
}

/** Test hook. */
export function modelRefCount(path: string): number {
  return counts.get(path) ?? 0;
}
