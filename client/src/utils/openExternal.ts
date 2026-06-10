/**
 * Open a URL in the system browser via the Electron preload bridge
 * (`electronShell.openExternal`, scheme-allowlisted in the main process).
 *
 * Used by both xterm link paths so terminal links open the same way:
 * - WebLinksAddon — plain-text URLs detected by regex.
 * - Terminal `linkHandler` — OSC 8 escape-sequence hyperlinks (e.g. the PR link
 *   `gh`/Claude Code emit). Without a `linkHandler`, xterm core falls back to a
 *   "could be dangerous" confirm() whose OK path is unreliable under Electron.
 */
export function openExternal(uri: string): void {
  (window as Window & { electronShell?: { openExternal: (u: string) => void } })
    .electronShell?.openExternal(uri);
}
