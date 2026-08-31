import type { HostDeps, NativeTerminalAddon, Rect } from './types.js';

/**
 * Owns every native terminal overlay. The native view is a CLIENT of
 * SessionManager: it is fed the same coalesced stream a socket room receives,
 * and its input/resize go back through the ordinary session entry points. It
 * never touches a pty.
 *
 * All policy lives here rather than in Swift so it can be tested without a
 * native build — the addon is injected.
 */
export class NativeTerminalHost {
  private readonly addon: NativeTerminalAddon | null;
  private readonly deps: HostDeps;
  private readonly bySession = new Map<string, number>();
  private readonly byOverlay = new Map<number, string>();
  private unsubscribe?: () => void;

  constructor(deps: HostDeps) {
    this.deps = deps;
    this.addon = deps.addon;
    if (!this.addon) return;

    this.unsubscribe = deps.onOutput((sessionId, data) => {
      const id = this.bySession.get(sessionId);
      if (id === undefined) return;               // not shown natively — ignore
      this.addon!.feed(id, Buffer.from(data, 'utf8'));
    });

    this.addon.onInput((id, data) => {
      const sessionId = this.byOverlay.get(id);
      if (sessionId) this.deps.writeToSession(sessionId, data.toString('utf8'));
    });

    // Native is the resize authority whenever an overlay exists (spec §2).
    this.addon.onResize((id, cols, rows) => {
      const sessionId = this.byOverlay.get(id);
      if (sessionId) this.deps.resizeSession(sessionId, cols, rows);
    });
  }

  isAvailable(): boolean {
    return this.addon !== null;
  }

  attach(sessionId: string, parentHandle: Buffer, rect: Rect): void {
    if (!this.addon) return;
    let id = this.bySession.get(sessionId);
    if (id === undefined) {
      id = this.addon.create(parentHandle);
      this.bySession.set(sessionId, id);
      this.byOverlay.set(id, sessionId);
      // Seed with the same replay frame a joining socket gets, so the native
      // view opens on the current screen instead of an empty one.
      const snap = this.deps.getReplaySnapshot(sessionId);
      if (snap) this.addon.feed(id, Buffer.from(snap.data, 'utf8'));
    }
    this.addon.setFrame(id, rect.x, rect.y, rect.width, rect.height);
    this.addon.show(id);
  }

  setRect(sessionId: string, rect: Rect): void {
    const id = this.bySession.get(sessionId);
    if (id === undefined || !this.addon) return;
    this.addon.setFrame(id, rect.x, rect.y, rect.width, rect.height);
  }

  show(sessionId: string): void {
    const id = this.bySession.get(sessionId);
    if (id !== undefined) this.addon?.show(id);
  }

  hide(sessionId: string): void {
    const id = this.bySession.get(sessionId);
    if (id !== undefined) this.addon?.hide(id);
  }

  detach(sessionId: string): void {
    const id = this.bySession.get(sessionId);
    if (id === undefined || !this.addon) return;
    this.addon.destroy(id);
    this.bySession.delete(sessionId);
    this.byOverlay.delete(id);
  }

  dispose(): void {
    for (const sessionId of [...this.bySession.keys()]) this.detach(sessionId);
    this.unsubscribe?.();
  }
}
