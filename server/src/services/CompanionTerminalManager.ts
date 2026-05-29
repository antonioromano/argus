import * as pty from 'node-pty';
import type { IPty } from 'node-pty';

const BUFFER_MAX = 100 * 1024; // 100 KB

interface CompanionEntry {
  pty: IPty;
  buffer: string;
}

/**
 * Manages companion terminals — one raw interactive shell per session.
 * Lifecycle is tied to the parent session: killed when the session is
 * destroyed or restarted. Unlike ephemeral terminals, companions persist
 * across socket disconnects and replay their output buffer on rejoin.
 */
export class CompanionTerminalManager {
  private terminals = new Map<string, CompanionEntry>();

  spawn(
    sessionId: string,
    folderPath: string,
    cols: number,
    rows: number,
    onData: (data: string) => void,
    onExit: (exitCode: number) => void,
  ): void {
    // Kill any existing terminal for this session before respawning
    this.kill(sessionId);

    const shell = process.env.SHELL || '/bin/zsh';
    let ptyProcess: IPty;
    try {
      ptyProcess = pty.spawn(shell, ['-l'], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: folderPath,
        env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
      });
    } catch {
      // pty.spawn throws synchronously on e.g. a deleted cwd. Report failure via
      // the exit callback instead of letting it bubble out of the socket handler
      // and crash the server.
      onExit(-1);
      return;
    }

    const entry: CompanionEntry = { pty: ptyProcess, buffer: '' };
    this.terminals.set(sessionId, entry);

    ptyProcess.onData((data) => {
      const current = this.terminals.get(sessionId);
      if (current && current.pty === ptyProcess) {
        current.buffer += data;
        if (current.buffer.length > BUFFER_MAX) {
          current.buffer = current.buffer.slice(current.buffer.length - BUFFER_MAX);
        }
      }
      onData(data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      // Guard: only clean up if this pty is still the active one (race condition safety)
      const current = this.terminals.get(sessionId);
      if (current && current.pty === ptyProcess) {
        this.terminals.delete(sessionId);
        onExit(exitCode);
      }
    });
  }

  write(sessionId: string, data: string): void {
    this.terminals.get(sessionId)?.pty.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.terminals.get(sessionId)?.pty.resize(cols, rows);
  }

  kill(sessionId: string): void {
    const entry = this.terminals.get(sessionId);
    if (!entry) return;
    this.terminals.delete(sessionId);
    try {
      entry.pty.kill();
    } catch {
      // already dead
    }
  }

  getBuffer(sessionId: string): string {
    return this.terminals.get(sessionId)?.buffer ?? '';
  }

  isAlive(sessionId: string): boolean {
    return this.terminals.has(sessionId);
  }
}
