import type {
  Terminal as XTerminal,
  ITerminalOptions,
  ITerminalInitOnlyOptions,
  IBufferCell,
  IBufferLine,
  IFunctionIdentifier,
} from '@xterm/headless';
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

/**
 * Replay history depth, fixed for the mirror's whole life. Deliberately not
 * adaptive: an xterm scrollback shrink drops the oldest rows permanently, and
 * because a join replays a full frame (ED 3) over the client's own buffer, the
 * mirror's depth is the ceiling on what anyone can ever scroll back to. Trading
 * ~10MB per idle mirror for history nobody can recover was the wrong trade.
 */
export const MIRROR_SCROLLBACK = 5000;

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
 * Escape sequences reproducing one cell's styling, or '' for default styling.
 * Attributes xterm exposes but we don't emit (protocol-level extras like
 * hyperlinks) degrade to plain text rather than to a wrong sequence.
 */
function cellSgr(cell: IBufferCell): string {
  const flags: number[] = [];
  if (cell.isBold()) flags.push(1);
  if (cell.isDim()) flags.push(2);
  if (cell.isItalic()) flags.push(3);
  if (cell.isUnderline()) flags.push(4);
  if (cell.isInverse()) flags.push(7);
  if (cell.isInvisible()) flags.push(8);
  if (cell.isStrikethrough()) flags.push(9);
  let out = flags.length > 0 ? `\x1b[${flags.join(';')}m` : '';
  if (cell.isFgPalette()) out += `\x1b[38;5;${cell.getFgColor()}m`;
  else if (cell.isFgRGB()) out += `\x1b[38;2;${rgb(cell.getFgColor())}m`;
  if (cell.isBgPalette()) out += `\x1b[48;5;${cell.getBgColor()}m`;
  else if (cell.isBgRGB()) out += `\x1b[48;2;${rgb(cell.getBgColor())}m`;
  return out;
}

const rgb = (packed: number): string =>
  `${(packed >> 16) & 0xff};${(packed >> 8) & 0xff};${packed & 0xff}`;

/**
 * One buffer row as an escape stream that reproduces its text and styling.
 * Emits an SGR run only where styling actually changes, and resets at the end so
 * the next row starts clean.
 */
function styleRow(line: IBufferLine): string {
  let out = '';
  let current = '';
  for (let x = 0; x < line.length; x++) {
    const cell = line.getCell(x);
    if (!cell) continue;
    // Width 0 is the trailing half of a wide character — already emitted.
    if (cell.getWidth() === 0) continue;
    const sgr = cellSgr(cell);
    if (sgr !== current) {
      out += `\x1b[0m${sgr}`;
      current = sgr;
    }
    const chars = cell.getChars();
    out += chars === '' ? ' ' : chars;
  }
  return current === '' ? out.replace(/ +$/, '') : `${out.replace(/ +$/, '')}\x1b[0m`;
}

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
/** CSI handler a consumer registered through the mirror (re-applied on wake). */
type CsiHook = { id: IFunctionIdentifier; cb: (params: (number | number[])[]) => boolean };

/** Synchronous parse on xterm's core — what makes a wake complete before it returns. */
type SyncWritable = { _core?: { writeSync?: (data: string) => void } };

export class TerminalMirror {
  /** Null only while hibernated (or disposed after hibernating). */
  private _term: XTerminal | null = null;
  private serializer: ISerializeAddon | null = null;
  /** Tiny stand-in served by `term` once a hibernated mirror is disposed. */
  private inert: XTerminal | null = null;
  /**
   * Set while hibernated: the frames this mirror would serve, captured once,
   * after which the emulator (~14MB at 5000 rows) is released. See hibernate().
   */
  private frozen: { full: string; screen: string; cols: number; rows: number } | null = null;
  /** CSI handlers consumers registered via registerCsiHandler (see wake). */
  private csiHooks: CsiHook[] = [];
  /**
   * A DECSTBM scroll region narrower than the screen is in force. serialize()
   * does not reproduce it, so a mirror rebuilt from a frame would scroll the
   * agent's later output differently — such a mirror is never hibernated.
   */
  private customScrollRegion = false;
  /** Serialises `term.write()` so buffer/serialize reads see a settled parser. */
  private writeQueue: Promise<void> = Promise.resolve();
  /** Feeds handed to the queue whose bytes the parser has not consumed yet. */
  private pendingWrites = 0;
  private destroyed = false;
  private scrollback: number;
  /** Currently-enabled DEC private modes (by numeric id), from DECSET/DECRST. */
  private privateModes = new Set<number>();
  /** DECTCEM (mode 25): terminals boot with the cursor visible. */
  private cursorVisible = true;
  /** Suppresses StateDetector's activity heuristic during a survivor re-seed. */
  private _seeding = false;
  /**
   * Bumped by everything that can change what serialize() returns: every feed
   * (when queued AND when parsed — ED 3, rebuildWithout, reset and DECSET/DECRST
   * mode changes all arrive as feeds) and every resize. Conservative on purpose:
   * a spurious bump only costs one recompute; a missed one would serve a stale
   * frame.
   */
  private generation = 0;
  /** serialize()/serializeScreen() results for `generation`, so a repeat join
   *  with no new output costs nothing (a full 5000-row serialize is ~47ms sync). */
  private frameCache: { generation: number; full?: string; screen?: string } = { generation: -1 };

  constructor(cols = 120, rows = 30, scrollback = MIRROR_SCROLLBACK) {
    this.scrollback = scrollback;
    this.createTerm(cols, rows);
  }

  /**
   * The emulator. Reading it wakes a hibernated mirror first, so every consumer
   * that reaches into the grid (StateDetector's classifier, diagnostics) sees
   * exactly the buffer it would have seen had the mirror never slept.
   */
  get term(): XTerminal {
    this.wake();
    if (this._term) return this._term;
    // Disposed while hibernated: nothing will read meaningfully, but a late
    // reader must not crash.
    this.inert ??= new Terminal({ cols: 1, rows: 1, scrollback: 0, allowProposedApi: true });
    return this.inert;
  }

  private createTerm(cols: number, rows: number): void {
    const term = new Terminal({ cols, rows, allowProposedApi: true, scrollback: this.scrollback });
    const addon = new SerializeAddon();
    term.loadAddon(addon as unknown as Parameters<XTerminal['loadAddon']>[0]);
    this._term = term;
    this.serializer = addon;
    this.registerModeScanner(term);
    for (const hook of this.csiHooks) term.parser.registerCsiHandler(hook.id, hook.cb);
  }

  /**
   * Register a CSI handler on the emulator's parser. Use this rather than
   * `term.parser.registerCsiHandler`: a handler registered on the raw terminal
   * is lost when a hibernated mirror wakes into a fresh one.
   */
  registerCsiHandler(id: IFunctionIdentifier, cb: (params: (number | number[])[]) => boolean): void {
    this.csiHooks.push({ id, cb });
    this.term.parser.registerCsiHandler(id, cb);
  }

  /** True while the emulator is released (see hibernate). */
  get hibernated(): boolean {
    return this.frozen !== null;
  }

  /**
   * Whether hibernate() would succeed now: a settled, normal-screen mirror with
   * no scroll region, on an xterm that can parse synchronously.
   */
  canHibernate(): boolean {
    if (this.destroyed || this.frozen || !this._term) return false;
    if (!this.isSettled() || this.customScrollRegion) return false;
    if (this._term.buffer.active.type !== 'normal') return false;
    return typeof (this._term as unknown as SyncWritable)._core?.writeSync === 'function';
  }

  /**
   * Release the emulator, keeping only the frames it would serve — the cheap
   * tier for a live session that is idle with nobody watching (the exited tier
   * in SessionManager does the same for good). Returns false, changing nothing,
   * when the mirror can't be rebuilt faithfully (see canHibernate).
   *
   * The way back is wake(): a fresh emulator parses the full frame — exactly
   * what every client does with a join's replay — so scrollback depth, row
   * indices, wrapping, cursor and modes come back as they were. The frame keeps
   * the whole MIRROR_SCROLLBACK window: hibernating never costs history.
   */
  hibernate(): boolean {
    if (!this.canHibernate()) return false;
    const term = this._term!;
    this.frozen = { full: this.serialize(), screen: this.serializeScreen(), cols: term.cols, rows: term.rows };
    this.releaseTerm();
    this.frameCache = { generation: -1 };
    this.generation++;
    return true;
  }

  /**
   * Rebuild the emulator from the frozen frame. Synchronous on purpose: callers
   * (a resize recording a dedup boundary, the classifier reading rows) read the
   * buffer straight after, and must see all of it — an async parse would hand
   * them a half-built grid, and a dedup boundary taken from one deletes the
   * wrong rows.
   */
  wake(): void {
    const f = this.frozen;
    if (!f || this.destroyed) return;
    this.frozen = null;
    this.createTerm(f.cols, f.rows);
    const term = this._term!;
    // Our handlers are all synchronous, which is the case writeSync supports;
    // silence its one-time "unreliable" warning for this deliberate use.
    const level = term.options.logLevel;
    term.options.logLevel = 'error';
    try {
      (term as unknown as SyncWritable)._core!.writeSync!(f.full);
    } finally {
      term.options.logLevel = level;
    }
    this.generation++;
  }

  private releaseTerm(): void {
    try {
      this.serializer?.dispose();
    } catch {
      // addon may already be gone
    }
    try {
      this._term?.dispose();
    } catch {
      // ignore double-dispose
    }
    this.serializer = null;
    this._term = null;
  }

  /**
   * Observe DECSET (`CSI ? Pm h`) / DECRST (`CSI ? Pm l`) to track which private
   * modes are enabled. Returns `false` so xterm still applies the mode itself —
   * we only shadow the state for serialize-append + `modes()`.
   */
  private registerModeScanner(term: XTerminal): void {
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
    term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (p) => apply(p, true));
    term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (p) => apply(p, false));
    // DECSTBM: `CSI r` (or a full-height region) resets the scroll region;
    // anything else narrows it.
    term.parser.registerCsiHandler({ final: 'r' }, (p) => {
      const top = (Array.isArray(p[0]) ? p[0][0] : p[0]) ?? 0;
      const bottom = (Array.isArray(p[1]) ? p[1][0] : p[1]) ?? 0;
      this.customScrollRegion = !(top <= 1 && (bottom === 0 || bottom >= term.rows));
      return false;
    });
  }

  /** Feed raw pty bytes into the emulator. Resolves once the parser has consumed them. */
  feed(data: string): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    this.wake(); // output for a sleeping session: rebuild before it lands
    this.pendingWrites++;
    this.generation++;
    this.writeQueue = this.writeQueue
      .then(
        () =>
          new Promise<void>((resolve) => {
            if (this.destroyed) {
              resolve();
              return;
            }
            this.term.write(data, () => {
              // Parsed: the buffer now reflects these bytes.
              this.generation++;
              resolve();
            });
          }),
      )
      .catch((err) => {
        // A rejected chain would permanently skip every later .then() on the
        // queue, freezing both replay and classification for this session.
        console.error('TerminalMirror writeQueue error:', err);
      })
      .finally(() => {
        this.pendingWrites--;
      });
    return this.writeQueue;
  }

  /** Resolves when all queued writes have been parsed — for post-write reads. */
  afterWrite(): Promise<void> {
    return this.writeQueue;
  }

  /**
   * True when every fed byte has been parsed, so a synchronous read
   * (serialize, readRows) reflects all of them. The parser runs in time
   * slices: a 2MB burst leaves it ~120ms behind the stream.
   */
  isSettled(): boolean {
    return this.pendingWrites === 0;
  }

  resize(cols: number, rows: number): void {
    if (this.destroyed || cols <= 0 || rows <= 0) return;
    this.generation++; // a resize reflows the buffer
    // xterm resets the scroll region on resize.
    this.customScrollRegion = false;
    try {
      this.term.resize(cols, rows);
    } catch {
      // xterm throws on invalid sizes — keep the current grid.
    }
  }

  /**
   * Drop the history rows, keep the visible screen (ED 3 — the same erase the
   * client's replay prefix uses). Goes through the write queue so it can't race
   * a pending feed. This is what makes "clear terminal" stick: without it the
   * mirror keeps every stale row and hands them straight back on the next
   * join/resync, duplicated blocks included.
   */
  clearScrollback(): Promise<void> {
    return this.feed('\x1b[3J');
  }

  /**
   * Wipe screen AND scrollback. Unlike clearScrollback this is not a user
   * gesture: it precedes an authoritative reseed (the daemon replaying a
   * session's ring after a reconnect), where keeping the old screen would
   * leave the pre-reconnect frame stacked above the replayed one.
   */
  reset(): Promise<void> {
    return this.feed('\x1b[2J\x1b[3J\x1b[H');
  }

  /** Rows the buffer holds: scrollback plus the visible screen. */
  totalRows(): number {
    if (this.destroyed) return 0;
    return this.term.buffer.active.baseY + this.term.rows;
  }

  /**
   * True once scrollback has hit its cap, at which point xterm evicts the oldest
   * row on every scroll and absolute row indices recorded earlier no longer point
   * at the same content. Callers holding such an index must give up rather than
   * act on a stale one.
   */
  scrollbackFull(): boolean {
    if (this.destroyed) return false;
    return this.term.buffer.active.baseY >= this.scrollback;
  }

  /** Plain text of rows `[from, to)`, trailing cell padding removed. */
  readRows(from: number, to: number): string[] {
    if (this.destroyed) return [];
    const buf = this.term.buffer.active;
    const end = Math.min(to, this.totalRows());
    const out: string[] = [];
    for (let y = Math.max(0, from); y < end; y++) {
      out.push(buf.getLine(y)?.translateToString(true) ?? '');
    }
    return out;
  }

  /**
   * Remove scrollback rows `[start, end)` — absolute buffer indices — keeping
   * everything else, including the visible screen. xterm has no row-range delete
   * and `\x1b[3J` is all-or-nothing, so the buffer is rebuilt: re-emit the rows
   * worth keeping, then paint the screen back over the top.
   *
   * Deliberately rebuilds **this** instance rather than swapping in a fresh one:
   * `StateDetector` holds our `term` and has a CSI handler registered on its
   * parser, so a swap would leave classification feeding a discarded terminal.
   *
   * Used to delete the stale, wrongly-wrapped copy an agent leaves behind when it
   * reprints its transcript after a width change (see `scrollbackDedup`).
   */
  async rebuildWithout(start: number, end: number): Promise<void> {
    if (this.destroyed) return;
    const buf = this.term.buffer.active;
    const baseY = buf.baseY;
    // Only scrollback is a candidate: the screen holds the content we are keeping.
    if (!(start >= 0 && end > start && end <= baseY)) return;

    // Before mutating anything — this is what gets painted back at the end.
    const screen = this.serializeScreen();

    const retained: string[] = [];
    for (let y = 0; y < baseY; y++) {
      if (y >= start && y < end) continue;
      const line = buf.getLine(y);
      if (line) retained.push(styleRow(line));
    }

    // The run of newlines after the retained rows is load-bearing: it pushes all
    // of them above the screen, so the restored screen paints over blank rows
    // instead of over history we just re-emitted.
    const rebuilt =
      '\x1b[2J\x1b[3J\x1b[H' +
      retained.join('\r\n') +
      (retained.length > 0 ? '\r\n' : '') +
      '\r\n'.repeat(this.term.rows) +
      '\x1b[H' +
      screen;

    // Suppress StateDetector's activity heuristic: this is our own rewrite, not
    // the agent producing output.
    this.markSeeding();
    try {
      await this.feed(rebuilt);
    } finally {
      this.clearSeeding();
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
    // A sleeping mirror answers joins from its frozen frame without waking.
    if (this.frozen) return this.frozen.full;
    return this.cachedFrame('full', () =>
      this.serializer!.serialize({ scrollback: this.scrollback }) + this.appendModes(),
    );
  }

  /**
   * The visible screen alone — no scrollback history. Payload for a mid-life
   * resync, whose whole point is to realign the client's screen WITHOUT the
   * `\x1b[3J` that a history-bearing frame needs to avoid stacking duplicate
   * rows. Modes are appended exactly as in serialize().
   */
  serializeScreen(): string {
    if (this.destroyed) return '';
    if (this.frozen) return this.frozen.screen;
    return this.cachedFrame('screen', () => this.serializer!.serialize({ scrollback: 0 }) + this.appendModes());
  }

  /**
   * Serve a frame from the cache when nothing has touched the buffer since it
   * was built. Only a *settled* mirror is cached: mid-parse the buffer changes
   * between generation bumps (xterm parses in time slices), so an unsettled
   * read is computed fresh and never stored.
   */
  private cachedFrame(kind: 'full' | 'screen', build: () => string): string {
    if (!this.isSettled()) return build();
    if (this.frameCache.generation !== this.generation) {
      this.frameCache = { generation: this.generation };
    }
    const hit = this.frameCache[kind];
    if (hit !== undefined) return hit;
    const frame = build();
    this.frameCache[kind] = frame;
    return frame;
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
    if (this.destroyed || this.frozen) return 'normal'; // only a normal screen hibernates
    return this.term.buffer.active.type === 'alternate' ? 'alternate' : 'normal';
  }

  markSeeding(): void {
    this._seeding = true;
  }

  clearSeeding(): void {
    this._seeding = false;
  }

  /** True once dispose() ran; every method is then a no-op. */
  get disposed(): boolean {
    return this.destroyed;
  }

  get seeding(): boolean {
    return this._seeding;
  }

  dispose(): void {
    this.destroyed = true;
    this.frameCache = { generation: -1 }; // release the cached strings
    this.frozen = null;
    this.releaseTerm();
    try {
      this.inert?.dispose();
    } catch {
      // ignore
    }
  }
}
