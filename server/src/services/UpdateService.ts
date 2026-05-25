import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { readFileSync, utimesSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { gt as semverGt, clean as semverClean, valid as semverValid } from 'semver';
import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, UpdateStatus } from '@argus/shared';

const execFile = promisify(execFileCb);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_PACKAGE_JSON = path.resolve(__dirname, '..', '..', '..', 'package.json');
const REPO_OWNER = 'antonioromano';
const REPO_NAME = 'code-orchestrator';
const REPO_BRANCH = 'master';
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

interface RemotePackageJson {
  version?: string;
}

export class UpdateService {
  private io: Server<ClientToServerEvents, ServerToClientEvents> | null = null;
  private readonly installedVersion: string = getCurrentVersion();
  private latestVersion: string | null = null;
  private changelog: string = '';
  private releaseUrl: string = '';
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private isApplying: boolean = false;
  private lastCheckAt: number = 0;

  setIo(io: Server<ClientToServerEvents, ServerToClientEvents>): void {
    this.io = io;
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
      const url = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/package.json`;
      const res = await fetch(url, { headers: { 'User-Agent': 'code-orchestrator-update-check' } });

      if (!res.ok) {
        console.warn(`[update] Could not fetch remote package.json (${res.status}), skipping check`);
        return;
      }

      const pkg = await res.json() as RemotePackageJson;
      const remoteVersion = semverClean(pkg.version ?? '') ?? semverValid(pkg.version ?? '');

      if (!remoteVersion) {
        console.warn(`[update] Could not parse remote version: ${pkg.version}`);
        return;
      }

      this.latestVersion = remoteVersion;
      this.releaseUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/commits/${REPO_BRANCH}`;

      this.io?.emit('update:available', this.getStatus());
    } catch (err) {
      console.warn('[update] Version check failed (network error), will retry next interval:', (err as Error).message);
    }
  }

  async applyUpdate(force?: boolean): Promise<{ success: boolean; error?: string; warning?: string; requiresConfirmation?: boolean }> {
    // In-app git pull is not applicable when running inside the Electron desktop app
    if (process.versions.electron) {
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
