export interface Rect { x: number; y: number; width: number; height: number }

/**
 * Argus's terminal theme, in the shape SwiftTerm's `setTheme` addon call
 * expects. `background`/`foreground`/`cursor` are "#rrggbb" strings; `ansi`
 * is the 16 ANSI colors in xterm order: black, red, green, yellow, blue,
 * magenta, cyan, white, then the bright variants. Built from the SAME color
 * values `useTerminal.ts` uses for xterm.js (see `nativeThemeFor` there) so
 * the two engines cannot drift apart.
 */
export interface Theme {
  background: string;
  foreground: string;
  cursor: string;
  ansi: string[];
}

/** The N-API surface. Declared as an interface so tests inject a fake and the
 *  host's logic is testable without building any native code. */
export interface NativeTerminalAddon {
  create(parentHandle: Buffer, scrollback: number): number;
  setFrame(id: number, x: number, y: number, w: number, h: number): void;
  setFontSize(id: number, size: number): void;
  setTheme(id: number, background: string, foreground: string, cursor: string, ansi: string[]): void;
  setDimmed(id: number, dimmed: boolean, isDark: boolean): void;
  reparent(id: number, parentHandle: Buffer): void;
  show(id: number): void;
  hide(id: number): void;
  destroy(id: number): void;
  feed(id: number, data: Buffer): void;
  /** The grid the overlay's last setFrame produced, read synchronously
   *  (onResize reports the same numbers, but asynchronously). Undefined for an
   *  unknown id. */
  gridSize(id: number): { cols: number; rows: number } | undefined;
  clearScrollback(id: number): void;
  focusOverlay(id: number): void;
  openFindBar(id: number): void;
  closeFindBar(id: number): void;
  onInput(cb: (id: number, data: Buffer) => void): void;
  onResize(cb: (id: number, cols: number, rows: number) => void): void;
  onFocus(cb: (id: number, focused: boolean) => void): void;
  onOpenLink(cb: (id: number, url: string) => void): void;
  onDropPaths(cb: (id: number, paths: string[]) => void): void;
  onBell(cb: (id: number) => void): void;
  onCopy(cb: (id: number, text: string) => void): void;
  onScrolledUp(cb: (id: number, scrolledUp: boolean) => void): void;
}

export interface HostDeps {
  addon: NativeTerminalAddon | null;   // null => unavailable, fall back to web
  onOutput(cb: (sessionId: string, data: string) => void): () => void;
  /**
   * Full replacement frames — the ones a socket room receives as an
   * unsolicited `session:replay` (the end of a backend reseed, a width-change
   * dedup, a scrollback purge). Each one supersedes what the view shows, and
   * a reseed's frame also carries output that was withheld from `onOutput`
   * while it ran, so a view that only listens to `onOutput` drifts.
   */
  onReplay(cb: (sessionId: string, data: string) => void): () => void;
  /**
   * Session status changes (running/waiting/done/idle/exited). The host
   * re-aligns a native view when output settles, as the xterm path does.
   */
  onStatus(cb: (sessionId: string, status: string) => void): () => void;
  /**
   * Emit the session's coalesced pending output now. Must run before a replay
   * snapshot is taken for a new viewer: pending bytes are already in the
   * mirror, so a later flush would deliver them a second time.
   */
  flushOutput(id: string): void;
  /**
   * Reports whether a native overlay is watching this session. A native view
   * never joins a socket room, so without this the server's idle-geometry
   * gate treats a natively viewed session as unwatched and shrinks its pty.
   */
  setViewing(id: string, viewing: boolean): void;
  writeToSession(id: string, data: string): void;
  resizeSession(id: string, cols: number, rows: number): void;
  /**
   * Reports that a native overlay's window became (or stopped being) the key
   * window. A click on a native tile goes to the child NSWindow, never to the
   * web contents, so without this the renderer's focus tracking — which every
   * "for the focused shell" command reads — can never see a native tile.
   */
  notifyFocus(id: string, focused: boolean): void;
  /**
   * File paths dropped onto a native terminal. Forwarded to the renderer,
   * which formats them with pathFormat.ts and writes them to the session —
   * the same path an xterm tile's drop takes. Quoting rules are not
   * reimplemented here.
   */
  notifyDropPaths(id: string, paths: string[]): void;
  /** Terminal bell on a native overlay; the renderer flashes the tile. */
  notifyBell(id: string): void;
  /**
   * Text the user copied from a native terminal. Forwarded so the renderer can
   * format it with terminalSelectionToClipboard — the same text an xterm tile
   * copies — rather than reimplementing that in main.
   */
  notifyCopy(id: string, text: string): void;
  /**
   * Opens a link the user activated inside a native terminal. Deliberately
   * routed out to the caller rather than opened in Swift: SwiftTerm's default
   * `requestOpenLink` calls NSWorkspace directly, which would bypass the
   * scheme allowlist every other Argus link path goes through.
   */
  openExternal(url: string): void;
  // SessionManager's frame is self-normalizing — `data` always leads with its
  // own buffer-switch/clear prefix (`\x1b[?1049l...`) and `serialize()`
  // re-emits `?1049h` itself when the session is on the alt screen (see
  // SessionManager.getReplaySnapshot's doc comment). The host has nothing to
  // branch on here and must feed this verbatim.
  getReplaySnapshot(id: string, flavor?: 'full' | 'screen'): { data: string } | undefined;
}
