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
  create(parentHandle: Buffer): number;
  setFrame(id: number, x: number, y: number, w: number, h: number): void;
  setTheme(id: number, background: string, foreground: string, cursor: string, ansi: string[]): void;
  reparent(id: number, parentHandle: Buffer): void;
  show(id: number): void;
  hide(id: number): void;
  destroy(id: number): void;
  feed(id: number, data: Buffer): void;
  clearScrollback(id: number): void;
  openFindBar(id: number): void;
  closeFindBar(id: number): void;
  onInput(cb: (id: number, data: Buffer) => void): void;
  onResize(cb: (id: number, cols: number, rows: number) => void): void;
}

export interface HostDeps {
  addon: NativeTerminalAddon | null;   // null => unavailable, fall back to web
  onOutput(cb: (sessionId: string, data: string) => void): () => void;
  writeToSession(id: string, data: string): void;
  resizeSession(id: string, cols: number, rows: number): void;
  // SessionManager's frame is self-normalizing — `data` always leads with its
  // own buffer-switch/clear prefix (`\x1b[?1049l...`) and `serialize()`
  // re-emits `?1049h` itself when the session is on the alt screen (see
  // SessionManager.getReplaySnapshot's doc comment). The host has nothing to
  // branch on here and must feed this verbatim.
  getReplaySnapshot(id: string): { data: string } | undefined;
}
