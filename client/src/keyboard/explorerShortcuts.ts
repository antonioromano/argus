/**
 * Handlers for explorer-scoped shortcuts, registered by the open ExplorerWorkbench
 * (null while none is open). The app-wide keydown handler and the menu bridge in
 * ArgusApp consult this before acting on a global action that shares the combo.
 */
export const explorerShortcuts: { findInFiles: (() => void) | null } = { findInFiles: null };
