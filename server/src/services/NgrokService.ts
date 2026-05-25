import { spawn, execFileSync, execFile as execFileCb } from 'child_process';
import type { ChildProcess } from 'child_process';
import { promisify } from 'util';

const execFile = promisify(execFileCb);
import * as http from 'http';
import type { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, NgrokStatus, NgrokTunnelStatus } from '@argus/shared';
import { SleepPreventionService } from './SleepPreventionService.js';

function findNgrok(): string | null {
  try {
    return execFileSync('which', ['ngrok'], { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

async function findNgrokAsync(): Promise<string | null> {
  try {
    const { stdout } = await execFile('which', ['ngrok']);
    return stdout.trim();
  } catch {
    return null;
  }
}

export class NgrokService {
  private ngrokPath: string | null;
  private process: ChildProcess | null = null;
  private tunnelStatus: NgrokTunnelStatus = 'disconnected';
  private publicUrl: string | null = null;
  private error: string | null = null;
  private io: Server<ClientToServerEvents, ServerToClientEvents> | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private pollAttempts = 0;
  private readonly MAX_POLL_ATTEMPTS = 20;
  private readonly sleepPrevention: SleepPreventionService;

  public getAuthRequired: () => boolean = () => false;
  public onDisconnect: (() => void) | null = null;

  constructor() {
    this.ngrokPath = findNgrok();
    this.sleepPrevention = new SleepPreventionService();
  }

  setIo(io: Server<ClientToServerEvents, ServerToClientEvents>): void {
    this.io = io;
  }

  get installed(): boolean {
    return this.ngrokPath !== null;
  }

  getStatus(): NgrokStatus {
    return {
      installed: this.installed,
      tunnelStatus: this.tunnelStatus,
      publicUrl: this.publicUrl,
      error: this.error,
      platform: process.platform,
      authRequired: this.getAuthRequired(),
    };
  }

  async recheckInstallation(): Promise<void> {
    this.ngrokPath = await findNgrokAsync();
  }

  async start(port: number = 5401): Promise<string> {
    if (this.tunnelStatus === 'connected' && this.publicUrl) {
      return this.publicUrl;
    }
    if (this.tunnelStatus === 'connecting') {
      throw new Error('ngrok is already starting');
    }
    if (!this.ngrokPath) {
      throw new Error('ngrok is not installed');
    }

    // Reuse an already-running ngrok instance if available
    const existingUrl = await this.pollNgrokApi();
    if (existingUrl) {
      this.publicUrl = existingUrl;
      this.tunnelStatus = 'connected';
      this.error = null;
      this.sleepPrevention.start();
      this.broadcastStatus();
      return existingUrl;
    }

    this.tunnelStatus = 'connecting';
    this.error = null;
    this.publicUrl = null;
    this.broadcastStatus();

    let stderrBuffer = '';
    this.process = spawn(this.ngrokPath, ['http', String(port)], { stdio: 'pipe' });

    this.process.stderr?.on('data', (data: Buffer) => {
      stderrBuffer += data.toString();
    });

    this.process.on('exit', () => {
      if (this.tunnelStatus !== 'disconnected') {
        const authErr =
          stderrBuffer.includes('authentication') ||
          stderrBuffer.includes('authtoken') ||
          stderrBuffer.includes('ERR_NGROK_4018');
        this.error = authErr
          ? 'ngrok authentication required. Run: ngrok config add-authtoken <your-token>'
          : stderrBuffer.trim() || 'ngrok process exited unexpectedly';
        this.tunnelStatus = 'error';
        this.publicUrl = null;
        this.stopPolling();
        this.sleepPrevention.stop();
        this.broadcastStatus();
        this.onDisconnect?.();
      }
      this.process = null;
    });

    return new Promise((resolve, reject) => {
      this.pollAttempts = 0;
      this.pollInterval = setInterval(async () => {
        this.pollAttempts++;

        if (this.tunnelStatus === 'error') {
          this.stopPolling();
          reject(new Error(this.error || 'ngrok failed to start'));
          return;
        }

        const url = await this.pollNgrokApi();
        if (url) {
          this.stopPolling();
          this.publicUrl = url;
          this.tunnelStatus = 'connected';
          this.error = null;
          this.sleepPrevention.start();
          this.broadcastStatus();
          resolve(url);
          return;
        }

        if (this.pollAttempts >= this.MAX_POLL_ATTEMPTS) {
          this.stopPolling();
          this.tunnelStatus = 'error';
          this.error = 'Timed out waiting for ngrok tunnel';
          this.broadcastStatus();
          reject(new Error(this.error));
        }
      }, 1000);
    });
  }

  async stop(): Promise<void> {
    this.stopPolling();
    this.sleepPrevention.stop();
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.tunnelStatus = 'disconnected';
    this.publicUrl = null;
    this.error = null;
    this.onDisconnect?.();
    this.broadcastStatus();
  }

  private stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private pollNgrokApi(): Promise<string | null> {
    return new Promise((resolve) => {
      const req = http.get('http://localhost:4040/api/tunnels', (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body) as { tunnels: Array<{ public_url: string }> };
            const tunnels = data.tunnels || [];
            const httpsTunnel = tunnels.find((t) => t.public_url?.startsWith('https://'));
            resolve(httpsTunnel?.public_url ?? null);
          } catch {
            resolve(null);
          }
        });
      });
      req.on('error', () => resolve(null));
      req.setTimeout(500, () => {
        req.destroy();
        resolve(null);
      });
    });
  }

  private broadcastStatus(): void {
    this.io?.emit('ngrok:status', this.getStatus());
  }
}
