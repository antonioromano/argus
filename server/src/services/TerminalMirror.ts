import type { Terminal as XTerminal, ITerminalOptions, ITerminalInitOnlyOptions } from '@xterm/headless';
// @xterm/headless ships CJS; Node's ESM↔CJS interop can't see the named export,
// so default-import the module object and pull `Terminal` off it (same pattern as
// StateDetector.ts — see the comment there).
import xtermHeadless from '@xterm/headless';
import serializeAddon from '@xterm/addon-serialize';

const Terminal = (xtermHeadless as unknown as {
  Terminal: new (opts?: ITerminalOptions & ITerminalInitOnlyOptions) => XTerminal;
}).Terminal;

interface ISerializeAddon {
  activate(t: XTerminal): void;
  serialize(opts?: { scrollback?: number }): string;
  dispose(): void;
}
const SerializeAddon = (serializeAddon as unknown as {
  SerializeAddon: new () => ISerializeAddon;
}).SerializeAddon;

/** Mouse-mode truth derived from the tracked DEC private modes (R6). */
export interface ReplayModes {
  /** Any button/motion tracking active: DECSET 1000 / 1002 / 1003. */
  appMouse: boolean;
  /** SGR extended mouse encoding active: DECSET 1006. */
  sgr: boolean;
}

/** Scrollback while a client is watching the session (deep replay history). */
export const MIRROR_SCROLLBACK = 5000;
/** Scrollback once no client is in the room — frees ~10MB/mirror (Q6); rejoin
 *  replays this depth until new output refills. */
export const MIRROR_IDLE_SCROLLBACK = 1000;

/**
 * DEC private modes whose *set* state `@xterm/addon-serialize@0.14.0` does NOT
 * re-emit, so we append them after serialize() (Q4). `1006` is load-bearing —
 * without it a replayed client emits legacy X10 mouse coords, breaking >223-col
 * reports and the tmux wheel-forward path (memory `argus-tmux-wheel-forward`).
 * `25` (DECTCEM cursor visibility) is cosmetic. Kept as a table so adding a
 * newly-discovered omitted mode is a one-line change.
 */
const SERIALIZE_OMITTED_SET_MODES = [1006] as const;

/**
 * Authoritative server-side screen for one session: a headless xterm fed every
 * pty byte, from which we serialize deterministic replay frames (plan
 * 2026-07-22-002). Owns the emulator, the write queue (reads happen only after
 * the parser has caught up), and a DECSET/DECRST scanner that tracks the mouse
 * + cursor modes serialize omits and that back the mouse-mode truth (R6).
 *
 * `StateDetector` consumes a mirror rather than owning its own terminal, so
 * classification and replay share a single emulator (R1).
 */
export class TerminalMirror {
  readonly term: XTerminal;
  private serializer: ISerializeAddon;
  /** Serialises `term.write()` so buffer/serialize reads see a settled parser. */
  private writeQueue: Promise<void> = Promise.resolve();
  private destroyed = false;
  private scrollback: number;
  /** Currently-enabled DEC private modes (by numeric id), from DECSET/DECRST. */
  private privateModes = new Set<number>();
  /** DECTCEM (mode 25): terminals boot with the cursor visible. */
  private cursorVisible = true;
  /** Suppresses StateDetector's activity heuristic during a survivor re-seed. */
  private _seeding = false;

  constructor(cols = 120, rows = 30, scrollback = MIRROR_SCROLLBACK) {
    this.scrollback = scrollback;
    this.term = new Terminal({ cols, rows, allowProposedApi: true, scrollback });
    const addon = new SerializeAddon();
    this.term.loadAddon(addon as unknown as Parameters<XTerminal['loadAddon']>[0]);
    this.serializer = addon;
    this.registerModeScanner();
  }

  /**
   * Observe DECSET (`CSI ? Pm h`) / DECRST (`CSI ? Pm l`) to track which private
   * modes are enabled. Returns `false` so xterm still applies the mode itself —
   * we only shadow the state for serialize-append + `modes()`.
   */
  private registerModeScanner(): void {
    const apply = (params: (number | number[])[], enable: boolean): boolean => {
      for (const p of params) {
        const n = Array.isArray(p) ? p[0] : p;
        if (n === undefined) continue;
        if (enable) this.privateModes.add(n);
        else this.privateModes.delete(n);
        if (n === 25) this.cursorVisible = enable;
      }
      return false; // fall through to xterm's own DECSET/DECRST handling
    };
    this.term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (p) => apply(p, true));
    this.term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (p) => apply(p, false));
  }

  /** Feed raw pty bytes into the emulator. Resolves once the parser has consumed them. */
  feed(data: string): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    this.writeQueue = this.writeQueue
      .then(
        () =>
          new Promise<void>((resolve) => {
            if (this.destroyed) {
              resolve();
              return;
            }
            this.term.write(data, () => resolve());
          }),
      )
      .catch((err) => {
        // A rejected chain would permanently skip every later .then() on the
        // queue, freezing both replay and classification for this session.
        console.error('TerminalMirror writeQueue error:', err);
      });
    return this.writeQueue;
  }

  /** Resolves when all queued writes have been parsed — for post-write reads. */
  afterWrite(): Promise<void> {
    return this.writeQueue;
  }

  resize(cols: number, rows: number): void {
    if (this.destroyed || cols <= 0 || rows <= 0) return;
    try {
      this.term.resize(cols, rows);
    } catch {
      // xterm throws on invalid sizes — keep the current grid.
    }
  }

  /** Adaptive scrollback: SessionManager raises to 5000 on client-join, lowers to 1000 on empty (Q6). */
  setScrollback(n: number): void {
    if (this.destroyed || n <= 0) return;
    this.scrollback = n;
    try {
      this.term.options.scrollback = n;
    } catch {
      // ignore — keep prior scrollback
    }
  }

  /**
   * Deterministic replay frame: the serialize addon's escape stream plus the
   * modes it omits (Q4). Restores faithfully into a *fresh* terminal; callers
   * replaying into a possibly-dirty client must prepend their own reset/clear
   * (phase-1 keeps the existing reconcile prefix — see plan 002 Unit 4 / Q5).
   */
  serialize(): string {
    if (this.destroyed) return '';
    return this.serializer.serialize({ scrollback: this.scrollback }) + this.appendModes();
  }

  /** Escape sequences for enabled modes that serialize() does not itself emit. */
  private appendModes(): string {
    let out = '';
    for (const mode of SERIALIZE_OMITTED_SET_MODES) {
      if (this.privateModes.has(mode)) out += `\x1b[?${mode}h`;
    }
    // Cursor visibility: default is visible and serialize omits it, so only a
    // hidden cursor needs re-asserting.
    if (!this.cursorVisible) out += '\x1b[?25l';
    return out;
  }

  /** Mouse-mode truth for the replay wire shape (R6). */
  modes(): ReplayModes {
    return {
      appMouse:
        this.privateModes.has(1000) || this.privateModes.has(1002) || this.privateModes.has(1003),
      sgr: this.privateModes.has(1006),
    };
  }

  bufferType(): 'normal' | 'alternate' {
    return this.term.buffer.active.type === 'alternate' ? 'alternate' : 'normal';
  }

  markSeeding(): void {
    this._seeding = true;
  }

  clearSeeding(): void {
    this._seeding = false;
  }

  get seeding(): boolean {
    return this._seeding;
  }

  dispose(): void {
    this.destroyed = true;
    try {
      this.serializer.dispose();
    } catch {
      // addon may already be gone
    }
    try {
      this.term.dispose();
    } catch {
      // ignore double-dispose
    }
  }
}
