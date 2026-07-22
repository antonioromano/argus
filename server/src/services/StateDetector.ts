import type { SessionStatus } from '@argus/shared';
import type { Terminal as XTerminal } from '@xterm/headless';
import { TerminalMirror } from './TerminalMirror.js';

// Standalone StateDetectors (unit tests) create their own mirror at the old
// scrollback depth; a session-backed detector is handed the shared session
// mirror (5000, adaptive) by SessionManager so classification and replay use
// one emulator.
const STANDALONE_SCROLLBACK = 500;

/**
 * Input-box rows — the agent's persistent text-entry line (e.g. Claude's
 * "│ > "). Present whether the agent is idle, working, OR waiting, so these are
 * NOT a waiting signal on their own (that would flip an actively-working
 * session to "waiting" the moment output pauses). They are used only to *anchor*
 * prompt-text extraction — the question sits just above the input box.
 */
const AGENT_INPUT_BOX_PATTERNS: Record<string, RegExp[]> = {
  claude: [
    /[│|┃]\s*>\s/,               // input-box row: "│ > …"
    /[│|┃]\s*❯\s/,               // alt prompt glyph
  ],
  gemini: [/[│|┃]\s*>\s/],
  codex: [/[│|┃]\s*>\s/],
};

/**
 * Prompt patterns evaluated against individual rendered rows from the terminal's
 * screen grid — NOT against the raw byte stream. These identify a *genuine*
 * pending question / confirmation / menu, meaning the agent is WAITING for a
 * user decision. The bare input box is intentionally NOT here (see
 * AGENT_INPUT_BOX_PATTERNS).
 */
const AGENT_PROMPT_PATTERNS: Record<string, RegExp[]> = {
  claude: [
    /\(y\/n\)/i,
    /\[y\/n\]/i,
    /\[Y\/n\]/,
    /\[y\/N\]/,
    /Do you want to proceed/i,
    /Would you like to proceed/i,
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
    /\(y\/n\)/i,
    /\[y\/n\]/i,
    /Yes\s*\/\s*No/i,
  ],
  codex: [
    /\(y\/n\)/i,
    /\[y\/n\]/i,
    /approve/i,
  ],
};

/**
 * Working-indicator patterns — a footer that means the agent is ACTIVELY
 * working, even when it only redraws a single low-volume line (which the
 * feed-count activity heuristic misses). Match the *structure* of Claude's
 * working footer, not the randomized verb ("Crafting", "Herding", …):
 * an elapsed-time + token counter, e.g. "(20s · ↓ 540 tokens)" /
 * "(16m 43s · ↑ 37.0k tokens)", or the "esc to interrupt" hint.
 * gemini/codex slots are intentionally empty until we have real captures.
 */
const AGENT_WORKING_PATTERNS: Record<string, RegExp[]> = {
  claude: [
    /esc to interrupt/i,
    /\(\s*\d+m?\s*\d*s?\s*·[^)]*\btokens\b/i,   // "(20s · ↓ 540 tokens)" / "(16m 43s · ↑ 37.0k tokens)"
    /[↑↓]\s*[\d.,]+\s*k?\s*tokens/i,            // bare "↓ 540 tokens" / "↑ 37.0k tokens"
  ],
  gemini: [],
  codex: [],
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

/**
 * Candidate lines that are clearly NOT the agent's question — echoes of the
 * user's own message in the transcript ("> …") and bare filesystem paths
 * (e.g. a screenshot dragged into the prompt leaves its /var/folders/… path
 * on screen). Matched after box-drawing strip + trim.
 */
const USER_ECHO = /^>\s/;
const BARE_FILE_PATH = /^[~/]\S*\/.*\.[A-Za-z0-9]{1,6}$/;
// Menu option rows ("❯ 1. Yes", "  2. No") — never the question itself.
const MENU_OPTION = /^❯?\s*\d+\.\s/;

/** Lines that look like the agent asking something — preferred as notification body. */
const QUESTION_SHAPED: RegExp[] = [
  /\?$/,
  /\bdo you want\b/i,
  /^(should|would|which|what|how|where|when|who|can|could|may|shall)\b/i,
];

const BOX_DRAWING_CHARS = /[│┃|╭╮╰╯─━┌┐└┘├┤┬┴┼·•▌▎▏]/g;
const MAX_PROMPT_LEN = 140;

const IDLE_SETTLE_MS = 500;
const DEBOUNCE_MS = 300;
const ACTIVITY_WINDOW_MS = 150;
const ACTIVITY_MIN_FEEDS = 3;
const SCAN_ROWS = 15;                 // rows from the bottom of the visible window to scan
const EXTRACT_SCAN_ROWS = 25;         // deeper window for notification-body extraction only —
                                      // tall AskUserQuestion menus push the question line above
                                      // the 15-row state-detection window
const CURSOR_ESC_WINDOW_MS = 1500;    // how long a recent cursor-style change counts as a hint
const RESIZE_GRACE_MS = 2000;         // suppress 'running' heuristic during SIGWINCH redraw window

/**
 * Point-in-time snapshot of the detector's internal signals. Surfaced by
 * `getDiagnostics()` for the session-diagnostics dump (and reused by the
 * `DEBUG_STATE` log) so a stuck/mis-detected status can be inspected off-box.
 */
export interface StateDetectorDiagnostics {
  currentStatus: SessionStatus;
  pendingStatus: SessionStatus | null;
  feedCount: number;
  /** `classify()` result at snapshot time: the immediate screen signal. */
  classified: 'running' | 'waiting' | null;
  recentCursorStyle: boolean;
  cursor: { x: number; y: number };
  lastReportedPrompt: string | undefined;
  extractedPrompt: string | undefined;
  /** ANSI-stripped tail of the rendered grid (what the classifier scans). */
  visibleRows: string[];
  resizeAgeMs: number;
  timing: Record<string, number>;
}

/**
 * State detector built on top of a headless xterm.js terminal emulator.
 *
 * Each pty byte stream is fed into the emulator so we can read the actual
 * rendered screen (and the cursor position) instead of pattern-matching a
 * flattened text log. This eliminates false positives from overlapping render
 * frames and lets us use the cursor's row as a first-class signal.
 */
export class StateDetector {
  /** The authoritative emulator; shared with replay when session-backed. */
  private mirror: TerminalMirror;
  /** True only when this detector created its own mirror (standalone/tests) and must dispose it. */
  private ownsMirror: boolean;
  /** Convenience accessor so the existing grid-reading code stays untouched. */
  private get term(): XTerminal {
    return this.mirror.term;
  }
  private onStatusChange: (status: SessionStatus) => void;
  private onPromptUpdate: ((text: string) => void) | null = null;
  /** Last prompt text surfaced to the owner (via transition or onPromptUpdate). */
  private lastReportedPrompt: string | undefined;
  private promptPatterns: RegExp[];
  private inputBoxPatterns: RegExp[];
  private workingPatterns: RegExp[];
  /** prompt + input-box patterns — used only to anchor prompt-text extraction. */
  private extractAnchorPatterns: RegExp[];
  private currentStatus: SessionStatus = 'running';
  private pendingStatus: SessionStatus | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private runningTimer: ReturnType<typeof setTimeout> | null = null;
  private feedCount = 0;
  private lastCursorStyleAt = 0;
  private lastResizeAt = 0;
  private destroyed = false;

  constructor(
    onStatusChange: (status: SessionStatus) => void,
    agentType: string = 'claude',
    cols: number = 120,
    rows: number = 30,
    mirror?: TerminalMirror,
  ) {
    this.onStatusChange = onStatusChange;
    this.promptPatterns = AGENT_PROMPT_PATTERNS[agentType] ?? DEFAULT_PROMPT_PATTERNS;
    this.inputBoxPatterns = AGENT_INPUT_BOX_PATTERNS[agentType] ?? [];
    this.workingPatterns = AGENT_WORKING_PATTERNS[agentType] ?? [];
    // Extraction anchors on either a real prompt or the input box (the question
    // sits just above the box even when the box itself isn't a waiting signal).
    this.extractAnchorPatterns = [...this.promptPatterns, ...this.inputBoxPatterns];
    // Consume the shared session mirror when provided; otherwise own a private
    // one (standalone/tests) at the historical scrollback depth.
    this.ownsMirror = !mirror;
    this.mirror = mirror ?? new TerminalMirror(cols, rows, STANDALONE_SCROLLBACK);

    // DECSCUSR (`\e[<n> q`) — cursor-style change. Many TUIs emit this when
    // the input box becomes active. Record the timestamp; we treat a very
    // recent one as a 'waiting' hint during settle(). Registered on the shared
    // emulator's parser (coexists with the mirror's own mode scanner).
    // `intermediates: ' '` matches the single-space intermediate in DECSCUSR.
    this.mirror.term.parser.registerCsiHandler({ intermediates: ' ', final: 'q' }, () => {
      this.lastCursorStyleAt = Date.now();
      return false; // fall through to default handling
    });
  }

  /**
   * Called when the session is already 'waiting' and a later repaint reveals
   * (or changes) the agent's question. Lets the owner refresh `lastPrompt`
   * after the one-shot extraction at the waiting transition missed — e.g. a
   * DECSCUSR cursor hint flips status to waiting before the menu is painted.
   * Never fires with undefined: transient blank repaints must not blank a
   * previously-extracted prompt.
   */
  setOnPromptUpdate(cb: (text: string) => void): void {
    this.onPromptUpdate = cb;
  }

  resize(cols: number, rows: number): void {
    if (cols <= 0 || rows <= 0) return;
    this.mirror.resize(cols, rows);
    // Stamp so the activity heuristic suppresses 'running' during the SIGWINCH redraw burst.
    this.lastResizeAt = Date.now();
  }

  /**
   * Suppress the activity heuristic during the full-screen repaint tmux sends
   * right after we re-attach to a surviving session — otherwise the redraw burst
   * looks like agent activity and flips status to 'running'. Reuses the resize
   * grace window.
   */
  markAttachRedraw(): void {
    this.lastResizeAt = Date.now();
  }

  feed(data: string): void {
    // pty flushes buffered output on kill, so onData can fire after destroy().
    // Ignore it — the emulator is disposed and the timers are gone.
    if (this.destroyed) return;

    // Feed raw bytes (ANSI and all) into the shared mirror so the grid updates
    // correctly. The mirror owns the write queue (reads see a settled parser).
    const written = this.mirror.feed(data);

    // Promptly classify on each settled write: a working footer or a real
    // prompt is a positive on-screen signal we act on immediately, without
    // waiting for the 500ms idle settle (which exists only to detect the
    // ABSENCE of both — e.g. the menu-that-never-quiets case where a blinking
    // cursor keeps output trickling so settle() would never run).
    written.then(() => {
      if (this.destroyed) return;
      const s = this.classify();
      if (s) this.scheduleStatus(s);
    });

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
        this.mirror.afterWrite().then(() => {
          if (this.destroyed) return;
          if (!this.screenShowsPrompt() && resizeAge >= RESIZE_GRACE_MS) this.scheduleStatus('running');
        });
      }
    }, ACTIVITY_WINDOW_MS);

    // After output settles, classify based on what's actually on the screen.
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.mirror.afterWrite().then(() => this.settle());
    }, IDLE_SETTLE_MS);
  }

  private settle(): void {
    if (this.destroyed) return;
    // Priority: a working footer wins (running), else a real prompt (waiting),
    // else the DECSCUSR cursor hint (waiting — catches a menu about to paint),
    // else the screen is quiet with no signal → idle. A bare input box is NOT
    // a signal here, so a finished session (box only) settles to idle.
    const classified = this.classify();
    const recentCursorStyle = Date.now() - this.lastCursorStyleAt < CURSOR_ESC_WINDOW_MS;

    if (classified === 'running') {
      this.scheduleStatus('running');
    } else if (classified === 'waiting' || recentCursorStyle) {
      this.scheduleStatus('waiting');
      // Already stably waiting (no transition pending → onStatusChange won't
      // refire): re-extract so a late-painted menu still reaches notifications.
      if (this.currentStatus === 'waiting' && this.pendingStatus === null) {
        const text = this.getLastPromptText();
        if (text !== undefined && text !== this.lastReportedPrompt) {
          this.lastReportedPrompt = text;
          this.onPromptUpdate?.(text);
        }
      }
    } else {
      this.scheduleStatus('idle');
    }

    if (process.env['DEBUG_STATE']) {
      const d = this.getDiagnostics();
      console.log(
        `[StateDetector] settle classified=${d.classified} recentCursorStyle=${d.recentCursorStyle} cursor=(${d.cursor.x},${d.cursor.y})\n` +
          d.visibleRows.join('\n'),
      );
    }
  }

  /** Collect the last `depth` content rows as text. */
  private visibleRows(depth: number = SCAN_ROWS): string[] {
    const buf = this.term.buffer.active;
    const rows = this.term.rows;
    // Anchor the window to the last non-empty row, not the viewport bottom —
    // after a clear+home redraw (e.g. Claude's plan-approval UI) the prompt
    // block sits at the TOP of the screen and a bottom-anchored window would
    // scan only blank rows.
    let end = rows - 1;
    while (end > 0) {
      const line = buf.getLine(buf.viewportY + end)?.translateToString(true);
      if (line && line.trim()) break;
      end--;
    }
    const start = Math.max(0, end + 1 - depth);
    const lines: string[] = [];
    for (let y = start; y <= end; y++) {
      const line = buf.getLine(buf.viewportY + y)?.translateToString(true);
      if (line) lines.push(line);
    }
    return lines;
  }

  /** True if any of the last few visible rows is a genuine pending prompt/menu. */
  private screenShowsPrompt(): boolean {
    const lines = this.visibleRows();
    for (const line of lines) {
      for (const p of this.promptPatterns) {
        if (p.test(line)) return true;
      }
    }
    return false;
  }

  /** True if a working-indicator footer (agent actively working) is on screen. */
  private screenShowsWorking(): boolean {
    if (this.workingPatterns.length === 0) return false;
    const lines = this.visibleRows();
    for (const line of lines) {
      for (const p of this.workingPatterns) {
        if (p.test(line)) return true;
      }
    }
    return false;
  }

  /**
   * Priority-ordered screen classifier. A visible working footer wins over
   * everything — it means the agent is actively working even when its output is
   * low-volume and even when the input box is on screen. A genuine prompt/menu
   * means waiting. Neither → null: an idle candidate, confirmed only once the
   * screen goes quiet (see settle()).
   */
  private classify(): 'running' | 'waiting' | null {
    if (this.screenShowsWorking()) return 'running';
    if (this.screenShowsPrompt()) return 'waiting';
    return null;
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
        // Keep the prompt-update baseline in sync with what the owner reads
        // via getLastPromptText() in its transition handler — onPromptUpdate
        // should only fire for text that appears AFTER the transition.
        this.lastReportedPrompt =
          this.currentStatus === 'waiting' ? this.getLastPromptText() : undefined;
        this.onStatusChange(this.currentStatus);
      }
      this.pendingStatus = null;
    }, DEBOUNCE_MS);
  }

  getStatus(): SessionStatus {
    return this.currentStatus;
  }

  /**
   * Snapshot every internal signal the classifier uses. Best-effort: reads the
   * emulator grid synchronously without draining the write queue, so it reflects
   * the state as of the last settled write. Returns empty/default values once
   * destroyed. Consumed by the session-diagnostics dump and `DEBUG_STATE`.
   */
  getDiagnostics(): StateDetectorDiagnostics {
    const timing = {
      IDLE_SETTLE_MS,
      DEBOUNCE_MS,
      ACTIVITY_WINDOW_MS,
      ACTIVITY_MIN_FEEDS,
      SCAN_ROWS,
      EXTRACT_SCAN_ROWS,
      CURSOR_ESC_WINDOW_MS,
      RESIZE_GRACE_MS,
    };
    if (this.destroyed) {
      return {
        currentStatus: this.currentStatus,
        pendingStatus: this.pendingStatus,
        feedCount: this.feedCount,
        classified: null,
        recentCursorStyle: false,
        cursor: { x: 0, y: 0 },
        lastReportedPrompt: this.lastReportedPrompt,
        extractedPrompt: undefined,
        visibleRows: [],
        resizeAgeMs: Date.now() - this.lastResizeAt,
        timing,
      };
    }
    const buf = this.term.buffer.active;
    return {
      currentStatus: this.currentStatus,
      pendingStatus: this.pendingStatus,
      feedCount: this.feedCount,
      classified: this.classify(),
      recentCursorStyle: Date.now() - this.lastCursorStyleAt < CURSOR_ESC_WINDOW_MS,
      cursor: { x: buf.cursorX, y: buf.cursorY },
      lastReportedPrompt: this.lastReportedPrompt,
      extractedPrompt: this.getLastPromptText(),
      visibleRows: this.visibleRows(),
      resizeAgeMs: Date.now() - this.lastResizeAt,
      timing,
    };
  }

  /**
   * Re-run classification now (after the write queue drains) and re-emit status.
   * Backs the "force re-detect" debug action for a session that looks stuck.
   */
  forceReclassify(): void {
    if (this.destroyed) return;
    this.mirror.afterWrite().then(() => {
      if (!this.destroyed) this.settle();
    });
  }

  /**
   * Best-effort extraction of the agent's pending question/prompt from the
   * rendered screen. Walks up from the input-box row, skips box-drawing-only
   * and footer-hint rows, returns the last remaining prose line.
   * Used by notification bodies; returns undefined if nothing meaningful found.
   */
  getLastPromptText(): string | undefined {
    if (this.destroyed) return undefined;
    // Deeper window than state detection: tall AskUserQuestion menus (long
    // option descriptions, multi-tab header) put the question >15 rows above
    // the footer.
    const rows = this.visibleRows(EXTRACT_SCAN_ROWS);

    // Find the bottom-most row that matches a prompt or input-box pattern —
    // that's the anchor (usually the input box, which sits below the question).
    let promptIdx = -1;
    for (let i = rows.length - 1; i >= 0; i--) {
      for (const p of this.extractAnchorPatterns) {
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
      // Skip echoes of the user's own message, bare file paths (e.g. a
      // dragged-in screenshot's /var/folders/… path) and menu option rows
      // ("❯ 1. Yes" / "  2. No") — never the agent's question.
      if (USER_ECHO.test(cleaned) || BARE_FILE_PATH.test(cleaned) || MENU_OPTION.test(cleaned)) continue;
      // Skip lines that are themselves prompt patterns (alt input boxes, etc.)
      // — unless they read like the question itself (e.g. "Would you like to
      // proceed?" is both a prompt pattern and the notification body we want).
      if (
        this.extractAnchorPatterns.some((p) => p.test(rows[i] ?? '')) &&
        !QUESTION_SHAPED.some((p) => p.test(cleaned))
      ) continue;
      candidates.push(cleaned);
    }

    // Prefer the nearest question-shaped line; otherwise the closest
    // meaningful line above the input box wins.
    const picked =
      candidates.find((c) => QUESTION_SHAPED.some((p) => p.test(c))) ?? candidates[0];
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
    // Only dispose the emulator we created; a shared session mirror is owned by
    // SessionManager and outlives the detector across restart.
    if (this.ownsMirror) this.mirror.dispose();
  }
}
