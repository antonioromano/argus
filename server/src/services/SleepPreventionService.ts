import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';

export class SleepPreventionService {
  private process: ChildProcess | null = null;
  private _electronBlockerId: number | undefined;

  async start(): Promise<void> {
    if (this.active) return;

    // Electron path: use powerSaveBlocker API (dynamic import avoids CLI build breakage)
    if (process.versions.electron) {
      // @ts-ignore — electron is only available at runtime in the Electron host
      const { powerSaveBlocker } = await import('electron');
      this._electronBlockerId = powerSaveBlocker.start('prevent-display-sleep');
      return;
    }

    const platform = process.platform;

    if (platform === 'darwin') {
      this.process = spawn('caffeinate', ['-di'], { stdio: 'ignore' });
    } else if (platform === 'linux') {
      this.process = spawn(
        'systemd-inhibit',
        ['--what=idle', '--who=Argus', '--why=ngrok tunnel active', 'sleep', 'infinity'],
        { stdio: 'ignore' }
      );
    } else {
      // Windows and others: no-op
      return;
    }

    this.process.on('exit', () => {
      this.process = null;
    });
  }

  async stop(): Promise<void> {
    // Electron path
    if (process.versions.electron && this._electronBlockerId !== undefined) {
      // @ts-ignore — electron is only available at runtime in the Electron host
      const { powerSaveBlocker } = await import('electron');
      powerSaveBlocker.stop(this._electronBlockerId);
      this._electronBlockerId = undefined;
      return;
    }

    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }

  get active(): boolean {
    if (process.versions.electron) {
      return this._electronBlockerId !== undefined;
    }
    return this.process !== null;
  }
}
