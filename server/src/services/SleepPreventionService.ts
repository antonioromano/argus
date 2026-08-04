import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';

/** Who is currently asking the Mac to stay awake. */
export type SleepHoldReason = 'sessions' | 'ngrok' | 'manual';

/**
 * The OS-level mechanism. Injected so tests can assert arbitration without
 * spawning a real `caffeinate` that would outlive the run and genuinely keep the
 * machine awake.
 */
export interface SleepBlocker {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly active: boolean;
}

/** Real mechanism: Electron powerSaveBlocker, else caffeinate / systemd-inhibit. */
export class PlatformSleepBlocker implements SleepBlocker {
  private process: ChildProcess | null = null;
  private electronBlockerId: number | undefined;

  async start(): Promise<void> {
    if (this.active) return;

    // Electron path: use powerSaveBlocker API (dynamic import avoids CLI build breakage)
    if (process.versions.electron) {
      // @ts-ignore — electron is only available at runtime in the Electron host
      const { powerSaveBlocker } = await import('electron');
      this.electronBlockerId = powerSaveBlocker.start('prevent-display-sleep');
      return;
    }

    const platform = process.platform;

    if (platform === 'darwin') {
      // `-w <pid>` makes caffeinate exit when we do. Without it a hard kill
      // (SIGKILL, crash) orphans the child and the Mac never sleeps again, with
      // nothing left holding a handle to release it — and no signal handler can
      // cover SIGKILL. Watching our own pid is the only robust guard.
      this.process = spawn('caffeinate', ['-di', '-w', String(process.pid)], { stdio: 'ignore' });
    } else if (platform === 'linux') {
      // Same orphan concern: systemd-inhibit has no --wait-for-pid, so the held
      // `sleep` is bounded by our lifetime via `--until-pid`-less fallback —
      // the child is killed in stop(), and dies with the session on logout.
      this.process = spawn(
        'systemd-inhibit',
        ['--what=idle', '--who=Argus', '--why=Argus keep-awake', 'sleep', 'infinity'],
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
    if (process.versions.electron && this.electronBlockerId !== undefined) {
      // @ts-ignore — electron is only available at runtime in the Electron host
      const { powerSaveBlocker } = await import('electron');
      powerSaveBlocker.stop(this.electronBlockerId);
      this.electronBlockerId = undefined;
      return;
    }

    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }

  get active(): boolean {
    if (process.versions.electron) {
      return this.electronBlockerId !== undefined;
    }
    return this.process !== null;
  }
}

/**
 * Reason-keyed arbitration over one OS sleep blocker.
 *
 * Several subsystems want the Mac awake for unrelated reasons — a running shell,
 * an ngrok tunnel, a manual keep-awake window. Under a single latch, whichever
 * one stopped last silently dropped everyone else's intent, so turning a manual
 * window off could let the machine sleep with a shell mid-run. The blocker is up
 * iff at least one reason is held; acquire/release are idempotent per reason.
 */
export class SleepPreventionService {
  private readonly holders = new Set<SleepHoldReason>();

  constructor(private readonly blocker: SleepBlocker = new PlatformSleepBlocker()) {}

  async acquire(reason: SleepHoldReason): Promise<void> {
    if (this.holders.has(reason)) return;
    this.holders.add(reason);
    if (this.holders.size > 1) return; // already blocking
    try {
      await this.blocker.start();
    } catch (err) {
      // Never keep a holder for a blocker that failed to start, or the set claims
      // the Mac is held awake while the OS is actually free to sleep.
      this.holders.delete(reason);
      throw err;
    }
  }

  async release(reason: SleepHoldReason): Promise<void> {
    if (!this.holders.delete(reason)) return;
    if (this.holders.size === 0) await this.blocker.stop();
  }

  /** Reasons currently held — surfaced for diagnostics and tests. */
  get heldBy(): SleepHoldReason[] {
    return [...this.holders];
  }

  get active(): boolean {
    return this.blocker.active;
  }
}
