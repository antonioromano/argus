export interface Rect { x: number; y: number; width: number; height: number }

/** The N-API surface. Declared as an interface so tests inject a fake and the
 *  host's logic is testable without building any native code. */
export interface NativeTerminalAddon {
  create(parentHandle: Buffer): number;
  setFrame(id: number, x: number, y: number, w: number, h: number): void;
  show(id: number): void;
  hide(id: number): void;
  destroy(id: number): void;
  feed(id: number, data: Buffer): void;
  clearScrollback(id: number): void;
  onInput(cb: (id: number, data: Buffer) => void): void;
  onResize(cb: (id: number, cols: number, rows: number) => void): void;
}

export interface HostDeps {
  addon: NativeTerminalAddon | null;   // null => unavailable, fall back to web
  onOutput(cb: (sessionId: string, data: string) => void): () => void;
  writeToSession(id: string, data: string): void;
  resizeSession(id: string, cols: number, rows: number): void;
  getReplaySnapshot(id: string): { data: string } | undefined;
}
