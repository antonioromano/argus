import { useCallback, useEffect, useRef } from 'react';
// Type-only: the ids are declared once, in the pure electron-side menu model.
// A new renderer-run menu item makes `MenuCommandHandlers` below incomplete,
// which fails the client type-check until the item has a handler here.
import type { RendererCommandId } from '../../../electron/src/menuModel.js';
import type { DedupeGate, MenuEchoGuard } from '../keyboard/scopes.js';
import { onMenuCommand } from './menuBridge.js';

export type RendererMenuId = RendererCommandId;
export type MenuCommandHandlers = Record<RendererMenuId, () => void>;

/** What the app does for each renderer-run menu item (ArgusApp supplies these). */
export interface MenuCommandDeps {
  openSettings(): void;
  togglePalette(): void;
  toggleTheme(): void;
  newSession(): void;
  closeSession(): void;
  reviewLaunch(): void;
  waitingInbox(): void;
  sessionSearch(): void;
  openDiff(): void;
  openFiles(): void;
  openShell(): void;
  terminalSearch(): void;
  clearTerminal(): void;
  whatsNew(): void;
  // Help surfaces (plan 002). Open-only (⌘/ reaches both the menu and keydown).
  about(): void;
  showShortcuts(): void;
  reportIssue(): void;
  copyDiagnostics(): void;
  /** Settings → Export… / Import… (plan 007): open Settings and run it. */
  exportSettings(): void;
  importSettings(): void;
  /** Shared with the keydown `command-palette` case: one ⌘K press toggles once. */
  paletteGate: DedupeGate;
  /** Shared with the keydown `toggle-theme` case: one ⌘⇧L press toggles once. */
  themeGate: DedupeGate;
  /** Claimed by a scoped shortcut (⌘⇧F → Find in Files) whose key the menu echoes. */
  scopedEcho: MenuEchoGuard;
}

/**
 * The id → action map. Pure, so the palette (a later PR) runs exactly what a
 * menu click runs. Toggles go through a dedupe gate because the menu
 * accelerator and the keydown handler can both deliver one keystroke; the
 * open-only items need none (opening twice is harmless).
 */
export function menuCommandHandlers(d: MenuCommandDeps): MenuCommandHandlers {
  return {
    'menu:open-settings': () => d.openSettings(),
    'menu:toggle-palette': () => { d.paletteGate.run(d.togglePalette); },
    'menu:toggle-theme': () => { d.themeGate.run(d.toggleTheme); },
    'menu:new-session': () => d.newSession(),
    'menu:close-session': () => d.closeSession(),
    'menu:review-launch': () => d.reviewLaunch(),
    'menu:waiting-inbox': () => d.waitingInbox(),
    'menu:session-search': () => { if (!d.scopedEcho.isEcho()) d.sessionSearch(); },
    'menu:open-diff': () => d.openDiff(),
    'menu:open-files': () => d.openFiles(),
    'menu:open-shell': () => d.openShell(),
    'menu:terminal-search': () => d.terminalSearch(),
    'menu:clear-terminal': () => d.clearTerminal(),
    'menu:whats-new': () => d.whatsNew(),
    'menu:about': () => d.about(),
    'menu:show-shortcuts': () => d.showShortcuts(),
    'menu:report-issue': () => d.reportIssue(),
    'menu:copy-diagnostics': () => d.copyDiagnostics(),
    'menu:export-settings': () => d.exportSettings(),
    'menu:import-settings': () => d.importSettings(),
  };
}

/**
 * Subscribes once to the app menu's `menu:command` stream and dispatches each
 * id to its handler, reading the latest `deps` at event time (latest-ref
 * pattern, so the subscription never churns). Returns a stable `run(id)` so
 * other callers (the command palette) run exactly what a menu click runs.
 */
export function useMenuCommandHandlers(deps: MenuCommandDeps): (id: RendererMenuId) => void {
  const depsRef = useRef(deps);
  useEffect(() => { depsRef.current = deps; });

  const run = useCallback((id: RendererMenuId) => {
    menuCommandHandlers(depsRef.current)[id]();
  }, []);

  useEffect(() => onMenuCommand((id) => {
    if (Object.hasOwn(menuCommandHandlers(depsRef.current), id)) run(id as RendererMenuId);
  }), [run]);

  return run;
}
