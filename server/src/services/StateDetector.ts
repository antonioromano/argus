import type { SessionStatus } from '@argus/shared';
import type { Terminal as XTerminal, ITerminalOptions, ITerminalInitOnlyOptions } from '@xterm/headless';
// The @xterm/headless package's main entry is CJS (lib-headless/xterm-headless.js);
// Node's ESM↔CJS interop can't statically detect the `exports.Terminal = …`
// assignment pattern it uses, so a named import throws at load time.
// Default-import the module object and pull `Terminal` off it instead.
import xtermHeadless from '@xterm/headless';
const Terminal = (xtermHeadless as unknown as {
  Terminal: new (opts?: ITerminalOptions & ITerminalInitOnlyOptions) => XTerminal;
}).Terminal;

/**
 * Prompt patterns evaluated against individual rendered rows from the terminal's
 * screen grid — NOT against the raw byte stream. This lets us anchor to line
 * start/end and recognize the specific shape of each agent's input box.
 */
const AGENT_PROMPT_PATTERNS: Record<string, RegExp[]> = {
  claude: [
    /[│|┃]\s*>\s/,               // input-box row: "│ > …"
    /[│|┃]\s*❯\s/,               // alt prompt glyph
    /\(y\/n\)/i,
    /\[y\/n\]/i,
    /\[Y\/n\]/,
    /\[y\/N\]/,
    /Do you want to proceed/i,
    /don.?t ask again for/i,
    /Allow once/i,
    /always allow access/i,
    /auto-accept edits/i,
    /manually approve edits/i,
    /shift\+tab to approve/i,
    /Esc to cancel/i,
    /Enter to select/i,           // AskUserQuestion footer
    /↑.+to navigate/i,           // AskUserQuestion navigation hint
    /^\s*❯\s+\d+\./,             // selected item in AskUserQuestion list (❯ 1. Label)
    /☐\s/,                       // AskUserQuestion checkbox header label
    /Tell Claude what to change/i,
    /Press Enter to continue/i,
  ],
  gemini: [
    /[│|┃]\s*>\s/,
    /\(y\/n\)/i,
    /\[y\/n\]/i,
    /Yes\s*\/\s*No/i,
  ],
  codex: [
    /[│|┃]\s*>\s/,
    /\(y\/n\)/i,
    /\[y\/n\]/i,
    /approve/i,
  ],
};

const DEFAULT_PROMPT_PATTERNS: RegExp[] = [
  /^\$\s*$/,
  /^#\s*$/,
  /^>\s*$/,
  /\(y\/n\)/i,
  /\[y\/n\]/i,
];

/**
 * Rows we should NOT use as notification body — UI chrome / footer hints, not the
 * actual question. Matched after stripping box-drawing chars and trimming.
 */
const PROMPT_FOOTER_NOISE: RegExp[] = [
  /^esc to (cancel|interrupt|clear)/i,
  /^enter to (select|submit|send|continue)/i,
  /^press enter to/i,
  /^shift\+tab/i,
  /^tab to/i,
  /^↑.*to navigate/i,
  /^ctrl\+[a-z]/i,
  /^\?\s*for shortcuts/i,
  /^auto-accept edits/i,
  /^manually approve edits/i,
  /^don.?t ask again/i,
  /^allow once/i,
  /^always allow access/i,
  /^>\s*$/,
  /^❯\s*$/,
];

const BOX_DRAWING_CHARS = /[│┃|╭╮╰╯─━┌┐└┘├┤┬┴┼·•▌▎▏]/g;
const MAX_PROMPT_LEN = 140;

const IDLE_SETTLE_MS = 500;
const DEBOUNCE_MS = 300;
const ACTIVITY_WINDOW_MS = 150;
const ACTIVITY_MIN_FEEDS = 3;
const SCAN_ROWS = 15;                 // rows from the bottom of the visible window to scan
const CURSOR_ESC_WINDOW_MS = 1500;    // how long a recent cursor-style change counts as a hint
const RESIZE_GRACE_MS = 2000;         // suppress 'running' heuristic during SIGWINCH redraw window

/**
 * State detector built on top of a headless xterm.js terminal emulator.
 *
 * Each pty byte stream is fed into the emulator so we can read the actual
 * rendered screen (and the cursor position) instead of pattern-matching a
 * flattened text log. This eliminates false positives from overlapping render
 * frames and lets us use the cursor's row as a first-class signal.
 */
export class StateDetector {
  private term: XTerminal;
  private onStatusChange: (status: SessionStatus) => void;
  private promptPatterns: RegExp[];
  private currentStatus: SessionStatus = 'running';
  private pendingStatus: SessionStatus | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private runningTimer: ReturnType<typeof setTimeout> | null = null;
  private feedCount = 0;
  private lastCursorStyleAt = 0;
  private lastResizeAt = 0;
  private destroyed = false;
  /** Serialises `term.write()` calls so buffer reads happen after the parser has caught up. */
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    onStatusChange: (status: SessionStatus) => void,
    agentType: string = 'claude',
    cols: number = 120,
    rows: number = 30,
  ) {
    this.onStatusChange = onStatusChange;
    this.promptPatterns = AGENT_PROMPT_PATTERNS[agentType] ?? DEFAULT_PROMPT_PATTERNS;
    this.term = new Terminal({
      cols,
      rows,
      allowProposedApi: true,
      scrollback: 500,
    });

    // DECSCUSR (`\e[<n> q`) — cursor-style change. Many TUIs emit this when
    // the input box becomes active. Record the timestamp; we treat a very
    // recent one as a 'waiting' hint during settle().
    // `intermediates: ' '` matches the single-space intermediate in DECSCUSR.
    this.term.parser.registerCsiHandler({ intermediates: ' ', final: 'q' }, () => {
      this.lastCursorStyleAt = Date.now();
      return false; // fall through to default handling
    });
  }

  resize(cols: number, rows: number): void {
    if (cols <= 0 || rows <= 0) return;
    try {
      this.term.resize(cols, rows);
    } catch {
      // xterm throws on invalid sizes — ignore and keep current grid
    }
    // Stamp so the activity heuristic suppresses 'running' during the SIGWINCH redraw burst.
    this.lastResizeAt = Date.now();
  }

  feed(data: string): void {
    // pty flushes buffered output on kill, so onData can fire after destroy().
    // Ignore it — the emulator is disposed and the timers are gone.
    if (this.destroyed) return;

    // Feed raw bytes (ANSI and all) to the emulator so the grid updates correctly.
    this.writeQueue = this.writeQueue.then(
      () => new Promise<void>((resolve) => {
        if (this.destroyed) { resolve(); return; }
        this.term.write(data, () => resolve());
      }),
    );

    // Sustained-output heuristic: many feeds in a short window suggests the
    // agent is actively producing output rather than just repainting.
    this.feedCount++;
    if (this.runningTimer) clearTimeout(this.runningTimer);
    this.runningTimer = setTimeout(() => {
      const count = this.feedCount;
      this.feedCount = 0;
      this.runningTimer = null;
      if (count >= ACTIVITY_MIN_FEEDS) {
        // Gate on actual screen state — don't flicker to 'running' if the
        // input box is already visible (Claude re-renders its prompt frequently).
        // Also suppress during resize grace window: SIGWINCH causes a full redraw
        // burst that looks like activity but isn't real agent work.
        const resizeAge = Date.now() - this.lastResizeAt;
        this.writeQueue.then(() => {
          if (this.destroyed) return;
          if (!this.screenShowsPrompt() && resizeAge >= RESIZE_GRACE_MS) this.scheduleStatus('running');
        });
      }
    }, ACTIVITY_WINDOW_MS);

    // After output settles, classify based on what's actually on the screen.
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.writeQueue.then(() => this.settle());
    }, IDLE_SETTLE_MS);
  }

  private settle(): void {
    if (this.destroyed) return;
    const hasPrompt = this.screenShowsPrompt();
    const recentCursorStyle = Date.now() - this.lastCursorStyleAt < CURSOR_ESC_WINDOW_MS;

    if (hasPrompt || recentCursorStyle) {
      this.scheduleStatus('waiting');
    } else {
      this.scheduleStatus('idle');
    }

    if (process.env['DEBUG_STATE']) {
      const snapshot = this.visibleRows().join('\n');
      console.log(
        `[StateDetector] settle hasPrompt=${hasPrompt} recentCursorStyle=${recentCursorStyle} cursor=(${this.term.buffer.active.cursorX},${this.term.buffer.active.cursorY})\n` +
          snapshot,
      );
    }
  }

  /** Collect the last SCAN_ROWS visible rows as text. */
  private visibleRows(): string[] {
    const buf = this.term.buffer.active;
    const rows = this.term.rows;
    const start = Math.max(0, rows - SCAN_ROWS);
    const lines: string[] = [];
    for (let y = start; y < rows; y++) {
      const line = buf.getLine(buf.viewportY + y)?.translateToString(true);
      if (line) lines.push(line);
    }
    return lines;
  }

  /** True if any of the last few visible rows looks like a prompt / input box. */
  private screenShowsPrompt(): boolean {
    const lines = this.visibleRows();
    for (const line of lines) {
      for (const p of this.promptPatterns) {
        if (p.test(line)) return true;
      }
    }
    return false;
  }

  /**
   * Debounced status update — requires the desired status to remain stable for
   * DEBOUNCE_MS before emitting, to avoid flicker from brief re-renders.
   */
  private scheduleStatus(status: SessionStatus): void {
    if (status === this.currentStatus && this.pendingStatus === null) return;
    if (status === this.pendingStatus) return;
    this.pendingStatus = status;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.pendingStatus !== null && this.pendingStatus !== this.currentStatus) {
        this.currentStatus = this.pendingStatus;
        this.onStatusChange(this.currentStatus);
      }
      this.pendingStatus = null;
    }, DEBOUNCE_MS);
  }

  getStatus(): SessionStatus {
    return this.currentStatus;
  }

  /**
   * Best-effort extraction of the agent's pending question/prompt from the
   * rendered screen. Walks up from the input-box row, skips box-drawing-only
   * and footer-hint rows, returns the last remaining prose line.
   * Used by notification bodies; returns undefined if nothing meaningful found.
   */
  getLastPromptText(): string | undefined {
    if (this.destroyed) return undefined;
    const rows = this.visibleRows();

    // Find the bottom-most row that matches a prompt pattern — that's the input box.
    let promptIdx = -1;
    for (let i = rows.length - 1; i >= 0; i--) {
      for (const p of this.promptPatterns) {
        if (p.test(rows[i] ?? '')) {
          promptIdx = i;
          break;
        }
      }
      if (promptIdx !== -1) break;
    }
    if (promptIdx === -1) return undefined;

    // Walk upward, collect non-noise, non-empty lines (stripped).
    const candidates: string[] = [];
    for (let i = promptIdx - 1; i >= 0; i--) {
      const cleaned = (rows[i] ?? '').replace(BOX_DRAWING_CHARS, ' ').trim();
      if (!cleaned) continue;
      if (PROMPT_FOOTER_NOISE.some((p) => p.test(cleaned))) continue;
      // Skip lines that are themselves prompt patterns (alt input boxes, etc.)
      if (this.promptPatterns.some((p) => p.test(rows[i] ?? ''))) continue;
      candidates.push(cleaned);
    }

    // Closest meaningful line above the input box wins.
    const picked = candidates[0];
    if (!picked) return undefined;
    return picked.length > MAX_PROMPT_LEN ? `${picked.slice(0, MAX_PROMPT_LEN - 1)}…` : picked;
  }

  setExited(): void {
    if (this.destroyed) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.runningTimer) clearTimeout(this.runningTimer);
    this.pendingStatus = null;
    if (this.currentStatus !== 'exited') {
      this.currentStatus = 'exited';
      this.onStatusChange('exited');
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.runningTimer) clearTimeout(this.runningTimer);
    this.term.dispose();
  }
}
