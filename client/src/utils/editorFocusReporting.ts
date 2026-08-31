/**
 * Reports "is any Monaco editor currently focused" to the Electron main
 * process, so it can disable the four menu accelerators that collide with
 * Monaco's own default keybindings (Cmd+D/E/F/L — see
 * electron/src/menuAcceleratorGating.ts) exactly while the keystroke needs to
 * reach Monaco instead of the menu. A no-op outside Electron (mobile
 * companion, dev:web) — `window.electronApp` is undefined there.
 *
 * Multiple Monaco instances can be mounted at once (hidden tabs kept alive
 * for buffer/view-state, plus a genuine side-by-side split — see
 * EditorTab.tsx), so this tracks a COUNT of instances currently believed
 * focused rather than a single last-writer boolean. MonacoPane's unmount
 * cleanup decrements even when a final blur never fired, so the count can
 * never get stuck above zero and leave the accelerators disabled forever —
 * the fail-safe this design exists to guarantee.
 */
let focusedCount = 0;

function report(): void {
  window.electronApp?.setEditorFocused(focusedCount > 0);
}

/** Pure — exported so the count transition is unit-testable without mounting Monaco. */
export function nextFocusCount(current: number, action: 'focus' | 'blur'): number {
  return action === 'focus' ? current + 1 : Math.max(0, current - 1);
}

export function noteEditorFocused(): void {
  focusedCount = nextFocusCount(focusedCount, 'focus');
  report();
}

export function noteEditorBlurred(): void {
  focusedCount = nextFocusCount(focusedCount, 'blur');
  report();
}
