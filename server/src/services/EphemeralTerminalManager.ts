import * as pty from 'node-pty';
import type { IPty } from 'node-pty';

interface EphemeralEntry {
  pty: IPty;
  socketId: string;
}

/**
 * Manages ephemeral terminals that live only for the duration of a socket
 * connection. They are not persisted, not shown in the session list, and are
 * automatically cleaned up when the socket disconnects.
 */
export class EphemeralTerminalManager {
  private terminals = new Map<string, EphemeralEntry>();

  spawn(
    id: string,
    socketId: string,
    cwd: string,
    cols: number,
    rows: number,
    onData: (data: string) => void,
    onExit: (exitCode: number) => void,
  ): void {
    // Kill any existing terminal with this id
    this.kill(id);

    const shell = process.env.SHELL || '/bin/zsh';
    const ptyProcess = pty.spawn(shell, ['-l'], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
    });

    ptyProcess.onData(onData);
    ptyProcess.onExit(({ exitCode }) => {
      // Guard: only delete/notify if this pty is still the active one for this id.
      // Without this check, a stale onExit from a killed pty would delete the
      // newer pty that replaced it (race condition with double-spawn from React
      // Strict Mode).
      const current = this.terminals.get(id);
      if (current && current.pty === ptyProcess) {
        this.terminals.delete(id);
        onExit(exitCode);
      }
    });

    this.terminals.set(id, { pty: ptyProcess, socketId });
  }

  write(id: string, data: string): void {
    this.terminals.get(id)?.pty.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    this.terminals.get(id)?.pty.resize(cols, rows);
  }

  kill(id: string): void {
    const entry = this.terminals.get(id);
    if (entry) {
      try { entry.pty.kill(); } catch { /* already dead */ }
      this.terminals.delete(id);
    }
  }

  killAllForSocket(socketId: string): void {
    for (const [id, entry] of this.terminals) {
      if (entry.socketId === socketId) {
        try { entry.pty.kill(); } catch { /* already dead */ }
        this.terminals.delete(id);
      }
    }
  }
}
