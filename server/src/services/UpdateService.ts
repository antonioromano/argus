import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { readFileSync, utimesSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { gt as semverGt, clean as semverClean, valid as semverValid } from 'semver';
import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, UpdateStatus, UpdateProgress } from '@argus/shared';

const execFile = promisify(execFileCb);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_PACKAGE_JSON = path.resolve(__dirname, '..', '..', '..', 'package.json');
const REPO_OWNER = 'antonioromano';
const REPO_NAME = 'argus';
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const CHECK_COOLDOWN_MS = 60 * 1000; // 60 seconds between on-demand checks

function getCurrentVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(ROOT_PACKAGE_JSON, 'utf-8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

interface GitHubRelease {
  tag_name?: string;
  body?: string;
  html_url?: string;
}

export interface ApplyUpdateResult {
  success: boolean;
  error?: string;
  warning?: string;
  requiresConfirmation?: boolean;
  /** Phase-1 found no newer version — informational, not an error. */
  upToDate?: boolean;
}

/**
 * Injected by the Electron host to perform a brew-based self-update + relaunch.
 *
 * The returned promise resolves with the *fast* outcome (Homebrew missing, or
 * "download started"). `onProgress` streams Phase-1 (trust → update → download)
 * progress to the UI. `onResult` fires for a *background* terminal outcome —
 * download failure or already-up-to-date — that happens after the download
 * started and the app is still open. On a successful download the host quits +
 * relaunches, so `onResult` is not called in that case.
 */
export type ApplyUpdateFn = (
  onProgress: (progress: UpdateProgress) => void,
  onResult: (result: ApplyUpdateResult) => void,
) => Promise<ApplyUpdateResult>;

export class UpdateService {
  private io: Server<ClientToServerEvents, ServerToClientEvents> | null = null;
  private readonly installedVersion: string = getCurrentVersion();
  private latestVersion: string | null = null;
  private changelog: string = '';
  private releaseUrl: string = '';
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private isApplying: boolean = false;
  private lastCheckAt: number = 0;
  private applyUpdateFn: ApplyUpdateFn | null = null;

  setIo(io: Server<ClientToServerEvents, ServerToClientEvents>): void {
    this.io = io;
  }

  /** Electron host injects the brew-based apply (download + relaunch) implementation. */
  setApplyUpdateFn(fn: ApplyUpdateFn): void {
    this.applyUpdateFn = fn;
  }

  start(): void {
    void this.checkForUpdate();
    this.checkInterval = setInterval(() => { void this.checkForUpdate(); }, CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  getStatus(): UpdateStatus {
    return {
      currentVersion: this.installedVersion,
      latestVersion: this.latestVersion,
      hasUpdate: this.latestVersion ? (semverGt(this.latestVersion, this.installedVersion) ?? false) : false,
      changelog: this.changelog,
      releaseUrl: this.releaseUrl,
    };
  }

  /** Re-emit current update status to a single newly-connected socket. */
  broadcastToSocket(socket: Socket<ClientToServerEvents, ServerToClientEvents>): void {
    const status = this.getStatus();
    if (status.hasUpdate) {
      socket.emit('update:available', status);
    }
  }

  async checkForUpdate(): Promise<void> {
    if (Date.now() - this.lastCheckAt < CHECK_COOLDOWN_MS) return;
    this.lastCheckAt = Date.now();
    try {
      const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'argus-update-check',
          'Accept': 'application/vnd.github+json',
        },
      });

      if (!res.ok) {
        console.warn(`[update] Could not fetch latest release (${res.status}), skipping check`);
        return;
      }

      const release = await res.json() as GitHubRelease;
      const remoteVersion = semverClean(release.tag_name ?? '') ?? semverValid(release.tag_name ?? '');

      if (!remoteVersion) {
        console.warn(`[update] Could not parse remote version: ${release.tag_name}`);
        return;
      }

      this.latestVersion = remoteVersion;
      this.changelog = (release.body ?? '').replace(/<!--[\s\S]*?-->/g, '').trim();
      this.releaseUrl = release.html_url ?? `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

      const status = this.getStatus();
      if (status.hasUpdate) {
        this.io?.emit('update:available', status);
      }
    } catch (err) {
      console.warn('[update] Version check failed (network error), will retry next interval:', (err as Error).message);
    }
  }

  async applyUpdate(force?: boolean): Promise<{ success: boolean; error?: string; warning?: string; requiresConfirmation?: boolean }> {
    // Inside the Electron desktop app, git pull does not apply. Defer to the
    // brew-based apply fn injected by the host. If none is set, fall back to refusal.
    if (process.versions.electron) {
      if (this.applyUpdateFn) {
        if (this.isApplying) {
          return { success: false, error: 'Update already in progress' };
        }
        this.isApplying = true;
        try {
          // Stream Phase-1 (trust → update → download) progress to the UI. The
          // promise resolves fast ("download started" or brew-missing); a slow
          // background failure / up-to-date arrives via onResult while the app
          // stays open. On a successful download the host quits + relaunches.
          const started = await this.applyUpdateFn(
            (progress) => { this.io?.emit('update:progress', progress); },
            (result) => {
              this.isApplying = false;
              if (!result.success) {
                this.io?.emit('update:failed', {
                  error: result.error ?? 'Update failed',
                  upToDate: result.upToDate,
                });
              }
            },
          );
          if (started.success) {
            this.io?.emit('update:applying');
          } else {
            this.isApplying = false;
            if (started.error) {
              this.io?.emit('update:failed', { error: started.error, upToDate: started.upToDate });
            }
          }
          return started;
        } catch (err) {
          this.isApplying = false;
          const message = (err as Error).message ?? 'Update failed';
          this.io?.emit('update:failed', { error: message });
          return { success: false, error: message };
        }
      }
      return {
        success: false,
        error: 'In-app update not available in the desktop app. Download the latest release from GitHub.',
      };
    }

    if (this.isApplying) {
      return { success: false, error: 'Update already in progress' };
    }
    this.isApplying = true;

    try {
      // Guard: check for uncommitted local changes
      const { stdout: statusOut } = await execFile('git', ['status', '--porcelain'], { cwd: this.repoRoot() });
      if (statusOut.trim()) {
        if (!force) {
          this.isApplying = false;
          return { success: false, warning: 'You have uncommitted local changes. They will be stashed automatically before updating. You can recover them later with `git stash pop`.', requiresConfirmation: true };
        }
        console.log('[update] Stashing local changes before pull...');
        await execFile('git', ['stash', '--include-untracked'], { cwd: this.repoRoot() });
        console.log('[update] Local changes stashed.');
      }

      // Run git pull
      const { stdout: pullOut } = await execFile('git', ['pull'], { cwd: this.repoRoot() });
      console.log('[update] git pull output:', pullOut.trim());

      this.io?.emit('update:applying');

      // Run npm install then exit — response has already been flushed by the time this fires
      setTimeout(() => {
        void (async () => {
          try {
            console.log('[update] Running npm install...');
            const { stdout } = await execFile('npm', ['install'], {
              cwd: this.repoRoot(),
              timeout: 120_000,
            });
            const summary = stdout.trim().split('\n').pop() ?? '';
            console.log('[update] npm install completed:', summary);
          } catch (err) {
            console.error('[update] npm install failed:', (err as Error).message);
          }
          // Touch a watched file so nodemon detects a change and restarts the process.
          // process.exit() does not work — nodemon waits for file changes on both clean and crash exits.
          const indexFile = path.join(__dirname, '..', 'index.ts');
          const now = new Date();
          utimesSync(indexFile, now, now);
        })();
      }, 500);

      return { success: true };
    } catch (err) {
      this.isApplying = false;
      const message = (err as Error).message ?? 'git pull failed';
      console.error('[update] applyUpdate error:', message);
      return { success: false, error: message };
    }
  }

  private repoRoot(): string {
    return path.dirname(ROOT_PACKAGE_JSON);
  }
}
