import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import { execFileSync } from 'child_process';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';

// Dedicated tmux socket so Argus's tmux server is isolated from the user's own
// tmux server. Every tmux invocation passes `-L <socket>`. The label is
// configurable (ARGUS_TMUX_SOCKET) so sibling forks / multiple installs each get
// their own tmux server instead of sharing sessions; defaults to 'argus'.
const TMUX_SOCKET = process.env.ARGUS_TMUX_SOCKET || 'argus';
const TMUX_NAME_PREFIX = 'argus-';

/** Single-quote a string for safe use inside a POSIX `sh -c` command. */
export function shquote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** Stable, collision-free tmux session name derived from a session UUID. */
export function tmuxSessionName(sessionId: string): string {
  // sessionIds are UUIDs (hex + hyphens, already tmux-safe) — sanitize defensively.
  return TMUX_NAME_PREFIX + sessionId.replace(/[^A-Za-z0-9_-]/g, '');
}

export class PtyManager {
  private commandPathCache = new Map<string, string>();
  private dataDir: string;
  // undefined = not yet resolved; null = resolved-and-unavailable; string = path
  private tmuxPath: string | null | undefined;
  private tmuxConfigPath: string | null = null;

  constructor(dataDir?: string) {
    this.dataDir = dataDir || path.join(os.homedir(), '.argus');
  }

  /**
   * Environment for spawned ptys. Guarantees a UTF-8 locale so tmux sends real
   * Unicode to its client instead of "_".
   *
   * tmux downgrades UTF-8 cells it can't represent for a NON-UTF-8 client —
   * block elements (the Claude welcome icon `▐▛███▜▌`) and dingbats (the `❯`
   * prompt) become "_"; box-drawing (`─`) survives via terminal-independent ACS.
   * The downgrade is per-CLIENT, decided from the client's LC_ALL/LC_CTYPE/LANG
   * at attach. Our tmux client is `pty.spawn(tmux, …, { env })`, so it inherits
   * the Electron process env — and a Finder/GUI-launched macOS app often has NO
   * LANG (launchd doesn't always set one), so the client attaches non-UTF-8 and
   * the whole agent renders garbled. (`capture-pane` is locale-independent, so
   * it always looked clean — which masked this for many releases.)
   *
   * Forcing a UTF-8 locale here makes rendering correct regardless of how the
   * app was launched. We only override when no UTF-8 locale is already present,
   * so a user's real locale is preserved.
   */
  private spawnEnv(): Record<string, string> {
    const env = { ...process.env, TERM: 'xterm-256color' } as Record<string, string>;
    const hasUtf8 = /UTF-?8/i.test(env.LC_ALL || env.LC_CTYPE || env.LANG || '');
    if (!hasUtf8) {
      env.LANG = 'en_US.UTF-8';
      env.LC_ALL = 'en_US.UTF-8';
    }
    return env;
  }

  private resolveCommand(command: string): string {
    if (this.commandPathCache.has(command)) {
      return this.commandPathCache.get(command)!;
    }
    try {
      const resolved = execFileSync('which', [command], { encoding: 'utf-8' }).trim();
      this.commandPathCache.set(command, resolved);
      return resolved;
    } catch {
      return command;
    }
  }

  // ─── tmux backing ─────────────────────────────────────────────────────────

  /**
   * Resolve a usable tmux binary, in priority order:
   *   1. ARGUS_TMUX_PATH env override (dev escape hatch)
   *   2. binary bundled inside the packaged .app (electron-builder extraResources)
   *   3. system tmux on PATH
   * Result is cached. null means tmux is unavailable → non-persistent fallback.
   */
  private resolveTmux(): string | null {
    if (this.tmuxPath !== undefined) return this.tmuxPath;

    let resolved: string | null = null;

    if (process.env.ARGUS_TMUX_PATH) {
      resolved = process.env.ARGUS_TMUX_PATH;
    }

    if (!resolved) {
      // process.resourcesPath only exists when running inside Electron.
      const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
      if (resourcesPath) {
        const bundled = path.join(resourcesPath, 'tmux', `tmux-${process.arch}`);
        try {
          if (existsSync(bundled)) resolved = bundled;
        } catch {
          /* ignore */
        }
      }
    }

    if (!resolved) {
      try {
        const which = execFileSync('which', ['tmux'], { encoding: 'utf-8' }).trim();
        if (which) resolved = which;
      } catch {
        /* tmux not on PATH */
      }
    }

    this.tmuxPath = resolved;
    if (resolved) {
      console.log(`[PtyManager] tmux found — sessions survive app quit (${resolved})`);
    } else {
      console.warn('[PtyManager] tmux not found — sessions will NOT survive app quit (non-persistent mode)');
    }
    return resolved;
  }

  isTmuxAvailable(): boolean {
    return this.resolveTmux() !== null;
  }

  /** Write (once) the tmux config that pins headless single-client behavior. */
  private ensureTmuxConfig(): string {
    if (this.tmuxConfigPath) return this.tmuxConfigPath;
    const conf = [
      'set-option -g status off',                              // no status bar — keeps StateDetector's bottom rows == agent's
      'set-option -g history-limit 50000',
      'set-option -g escape-time 0',                           // no Esc delay — preserves claude Esc-to-cancel
      'set-option -g destroy-unattached off',                  // linchpin: keep session alive when our client detaches
      'set-option -g default-terminal "xterm-256color"',
      'set-option -ga terminal-overrides ",xterm-256color:Tc"', // truecolor passthrough
      'set-option -g window-size latest',                      // pane tracks the (single) attached client size
      'set-window-option -g aggressive-resize on',
      'set-window-option -g remain-on-exit on',                // keep dead pane so we can detect exited-while-detached
      'set-option -g mouse on',                                // route forwarded wheel reports into tmux
      // Wheel-up: forward to the app when it holds mouse mode (Claude scrolls its
      // own conversation — its alt-screen content isn't in tmux history, so
      // copy-mode there is a useless [0/0]). Fall back to copy-mode only for a
      // no-mouse pane (a shell prompt, where the 50k backlog IS the real history).
      'bind-key -n WheelUpPane if-shell -F "#{mouse_any_flag}" "send-keys -M" "copy-mode -e"',
      // Wheel-down: forward to a mouse app so Claude scrolls down too. Bound
      // explicitly (not left to tmux's default) so it also overwrites any stale
      // WheelDownPane on a survivor tmux server from an older build.
      'bind-key -n WheelDownPane if-shell -F "#{mouse_any_flag}" "send-keys -M"',
      '',
    ].join('\n');
    try {
      mkdirSync(this.dataDir, { recursive: true });
    } catch {
      /* already exists */
    }
    const p = path.join(this.dataDir, 'tmux.conf');
    writeFileSync(p, conf, 'utf-8');
    this.tmuxConfigPath = p;
    return p;
  }

  /** Prefix args common to every tmux invocation (socket + config). */
  private tmuxArgs(...args: string[]): string[] {
    return ['-L', TMUX_SOCKET, '-f', this.ensureTmuxConfig(), ...args];
  }

  /**
   * Best-effort: push the mouse/copy-mode options onto an ALREADY-RUNNING tmux
   * server. The `-f` config file is only read when the server first starts, so a
   * survivor server (sessions that outlived a prior app run) wouldn't otherwise
   * pick up these settings. Idempotent — safe to call on every spawn.
   */
  private applyMouseConfig(): void {
    try {
      this.runTmux(['set-option', '-g', 'mouse', 'on']);
      this.runTmux(['bind-key', '-n', 'WheelUpPane', 'if-shell', '-F', '#{mouse_any_flag}', 'send-keys -M', 'copy-mode -e']);
      this.runTmux(['bind-key', '-n', 'WheelDownPane', 'if-shell', '-F', '#{mouse_any_flag}', 'send-keys -M']);
    } catch {
      /* server not up yet → the -f config covers the fresh-server case */
    }
  }

  /** Run a tmux control command synchronously, returning stdout. Throws on failure. */
  private runTmux(args: string[]): string {
    const tmux = this.resolveTmux();
    if (!tmux) throw new Error('tmux not available');
    // Capture stdout; silence stderr ("no server running" etc. are expected on
    // the not-found / server-gone edges and are handled by callers via throw).
    return execFileSync(tmux, this.tmuxArgs(...args), { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  }

  /**
   * Build the `sh -c` command string tmux runs to launch the agent. tmux executes
   * this via `/bin/sh -c`, which then runs the user's login shell — so flags pass
   * through TWO `sh -c` layers and must survive both. shquote handles the outer layer;
   * the inner login-shell layer re-parses the single-quoted exec line.
   */
  private buildAgentCommand(resolvedCommand: string, flags?: string[]): string {
    const shell = process.env.SHELL || '/bin/zsh';
    const flagStr = flags?.length ? ' ' + flags.map(shquote).join(' ') : '';
    const inner = `exec ${resolvedCommand}${flagStr}`;
    return `${shell} -l -c ${shquote(inner)}`;
  }

  /**
   * Spawn (or re-attach to) a tmux-backed agent session. The returned pty is a
   * tmux *client*; killing it detaches without stopping the agent. The agent
   * process is owned by the tmux server (an independent daemon), so it survives
   * the Electron app quitting. `new-session -A` attaches if the session already
   * exists (a survivor), else creates it fresh.
   */
  spawnTmux(
    tmuxName: string,
    folderPath: string,
    command: string = 'claude',
    cols: number = 120,
    rows: number = 30,
    flags?: string[],
  ): IPty {
    const tmux = this.resolveTmux();
    if (!tmux) throw new Error('tmux not available');
    const resolvedCommand = this.resolveCommand(command);
    const agentCmd = this.buildAgentCommand(resolvedCommand, flags);
    const args = this.tmuxArgs(
      'new-session', '-A',
      '-s', tmuxName,
      '-x', String(cols),
      '-y', String(rows),
      '-c', folderPath,
      agentCmd,
    );
    const client = pty.spawn(tmux, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: folderPath,
      env: this.spawnEnv(),
    });
    // The server is up now (new-session created/attached it); ensure a survivor
    // server also has mouse + wheel-scroll bindings (fresh servers get it via -f).
    this.applyMouseConfig();
    return client;
  }

  /** True if a tmux session with this name currently exists. */
  hasTmuxSession(tmuxName: string): boolean {
    try {
      this.runTmux(['has-session', '-t', tmuxName]);
      return true;
    } catch {
      return false;
    }
  }

  /** True if the session's pane has already exited (kept around by remain-on-exit). */
  isTmuxPaneDead(tmuxName: string): boolean {
    try {
      const out = this.runTmux(['list-panes', '-t', tmuxName, '-F', '#{pane_dead}']).trim();
      return out.split('\n').some((l) => l.trim() === '1');
    } catch {
      return false;
    }
  }

  /**
   * Capture the current visible screen of a tmux pane as a clean, valid escape
   * stream (colors preserved via -e). Used to replay a correct frame on
   * (re)attach instead of the raw byte buffer, which can be sliced mid-escape
   * and render garbled in a fresh xterm.
   */
  capturePane(tmuxName: string, historyLines = 0): string {
    // -S -<N> starts N lines back into scrollback history; tmux clamps to what
    // exists if history is shorter. Omitted (default 0) → visible screen only.
    const hist = historyLines > 0 ? ['-S', `-${historyLines}`] : [];
    return this.runTmux(['capture-pane', '-p', '-e', ...hist, '-t', tmuxName]);
  }

  /**
   * Pane state needed to build a correct, self-reconciling replay frame, in one
   * tmux round-trip:
   *  - cursor cell (tmux's 0-based screen coordinates)
   *  - `alternate`: whether the alternate screen (vim/less — no meaningful
   *    scrollback) is active, so the client can force xterm onto the matching
   *    buffer instead of painting into a stale one
   *  - `appMouse`: whether the inner app has ANY mouse-tracking mode on
   *    (`#{mouse_any_flag}`), so the client's wheel-forwarding gate matches the
   *    app's truth rather than a value persisted across reload
   *  - `sgr`: whether the app requested SGR mouse encoding (`#{mouse_sgr_flag}`)
   * Falls back to a safe default (normal screen, no mouse, SGR, cursor home) if
   * the lookup fails — a gate that stays OFF can't get stuck forwarding wheels.
   */
  captureState(tmuxName: string): {
    cursorX: number;
    cursorY: number;
    alternate: boolean;
    appMouse: boolean;
    sgr: boolean;
  } {
    try {
      const out = this.runTmux([
        'display-message', '-p', '-t', tmuxName,
        '#{cursor_x},#{cursor_y},#{alternate_on},#{mouse_any_flag},#{mouse_sgr_flag}',
      ]).trim();
      const [cx, cy, alt, mouseAny, mouseSgr] = out.split(',');
      return {
        cursorX: Number.parseInt(cx, 10) || 0,
        cursorY: Number.parseInt(cy, 10) || 0,
        alternate: alt === '1',
        appMouse: mouseAny === '1',
        // Default to SGR (modern apps use it) when the flag is absent/unknown.
        sgr: mouseSgr === '1' || mouseSgr === undefined,
      };
    } catch {
      return { cursorX: 0, cursorY: 0, alternate: false, appMouse: false, sgr: true };
    }
  }

  /**
   * Cancel tmux copy-mode if the pane is parked in it. A resync/replay capture
   * fired while the user has scrolled into copy-mode history would otherwise
   * snapshot the scrolled view and pin the client there. `-X cancel` is a no-op
   * (swallowed) when the pane isn't in copy-mode.
   */
  exitCopyMode(tmuxName: string): void {
    try {
      this.runTmux(['send-keys', '-t', tmuxName, '-X', 'cancel']);
    } catch {
      /* not in copy-mode / pane gone — nothing to cancel */
    }
  }

  /** Names of all live argus-* tmux sessions (survivors from a previous run). */
  listArgusSessions(): Set<string> {
    const set = new Set<string>();
    try {
      const out = this.runTmux(['list-sessions', '-F', '#{session_name}']);
      for (const line of out.split('\n')) {
        const name = line.trim();
        if (name.startsWith(TMUX_NAME_PREFIX)) set.add(name);
      }
    } catch {
      /* no server running → no survivors */
    }
    return set;
  }

  /** Actually terminate an agent (vs. merely detaching). Swallows not-found. */
  killTmuxSession(tmuxName: string): void {
    try {
      this.runTmux(['kill-session', '-t', tmuxName]);
    } catch {
      /* already gone */
    }
  }

  /** Kill the entire argus tmux server (all sessions). Used by "Quit & Stop All". */
  killTmuxServer(): void {
    try {
      this.runTmux(['kill-server']);
    } catch {
      /* not running */
    }
  }

  // ─── non-persistent fallback (tmux unavailable) ────────────────────────────

  spawn(folderPath: string, command: string = 'claude', cols: number = 120, rows: number = 30, flags?: string[]): IPty {
    const resolvedCommand = this.resolveCommand(command);
    const shell = process.env.SHELL || '/bin/zsh';
    const flagStr = flags?.length ? ' ' + flags.map(f => `'${f.replace(/'/g, "'\\''")}'`).join(' ') : '';
    return pty.spawn(shell, ['-l', '-c', `exec ${resolvedCommand}${flagStr}`], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: folderPath,
      env: this.spawnEnv(),
    });
  }

  write(ptyProcess: IPty, data: string): void {
    ptyProcess.write(data);
  }

  resize(ptyProcess: IPty, cols: number, rows: number): void {
    ptyProcess.resize(cols, rows);
  }

  kill(ptyProcess: IPty): void {
    ptyProcess.kill();
  }
}
