import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import { execFileSync } from 'child_process';

export class PtyManager {
  private commandPathCache = new Map<string, string>();

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

  spawn(folderPath: string, command: string = 'claude', cols: number = 120, rows: number = 30, flags?: string[]): IPty {
    const resolvedCommand = this.resolveCommand(command);
    const shell = process.env.SHELL || '/bin/zsh';
    const flagStr = flags?.length ? ' ' + flags.map(f => `'${f.replace(/'/g, "'\\''")}'`).join(' ') : '';
    return pty.spawn(shell, ['-l', '-c', `exec ${resolvedCommand}${flagStr}`], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: folderPath,
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
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
