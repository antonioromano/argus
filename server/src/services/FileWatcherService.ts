import { watch as fsWatch, type FSWatcher } from 'fs';
import path from 'path';

/**
 * Directories whose contents are noise or too heavy to watch — mirrors the
 * exclusion set in utils/fsChildren.ts so the watcher and the tree agree on
 * what is browsable.
 */
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  '__pycache__',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.cache',
  'coverage',
  '.terraform',
]);

const DEFAULT_DEBOUNCE_MS = 200;

/**
 * FSEvents delivers a burst of events for changes made shortly BEFORE the
 * watcher armed (coarse since-when granularity) — e.g. the session folder's
 * own creation. Events inside this window after arming are dropped so a new
 * watcher doesn't fire a phantom refresh; anything the user actually changes
 * later still reports normally.
 */
const ARMING_GRACE_MS = 200;

export type FsChangeHandler = (sessionId: string, dirs: string[]) => void;

interface WatchEntry {
  watcher: FSWatcher;
  /** Parent dirs of changed entries, accumulated between debounce flushes. */
  pending: Set<string>;
  timer: NodeJS.Timeout | null;
}

/**
 * Watches each session's folder for filesystem changes and reports the
 * (debounced, de-duplicated) set of parent directories that changed, so the
 * client can re-fetch just those folders. One native recursive watcher per
 * session.
 *
 * Uses node's fs.watch with `recursive: true`, which on macOS is a single
 * FSEvents stream per watched root. The previous chokidar implementation
 * created one watch handle per file/directory; on a large repo that exhausted
 * the kernel's per-process watch limit (EMFILE regardless of the fd ulimit),
 * and tearing the broken watcher down closed tens of thousands of fsevents
 * handles — each blocking the main thread on a semaphore — freezing the app
 * at startup. Exclusions are filtered per-event instead of at watch time.
 */
export class FileWatcherService {
  private readonly watchers = new Map<string, WatchEntry>();

  constructor(
    private readonly onChange: FsChangeHandler,
    private readonly debounceMs: number = DEFAULT_DEBOUNCE_MS,
  ) {}

  /** Start watching a session's folder. No-op if already watching it. */
  watch(sessionId: string, folderPath: string): void {
    if (this.watchers.has(sessionId)) return;

    let watcher: FSWatcher;
    const armedAt = Date.now();
    try {
      watcher = fsWatch(folderPath, { recursive: true }, (_event, filename) => {
        if (Date.now() - armedAt < ARMING_GRACE_MS) return;
        if (!filename) {
          // Rare overflow/unknown-path case — refresh the root.
          this.enqueue(sessionId, folderPath);
          return;
        }
        const rel = filename.toString();
        if (rel.split(path.sep).some((seg) => EXCLUDED_DIRS.has(seg))) return;
        this.enqueue(sessionId, path.dirname(path.join(folderPath, rel)));
      });
    } catch (err) {
      console.error(`[FileWatcher] ${sessionId}: failed to watch ${folderPath}:`, err);
      return;
    }

    watcher.on('error', (err) => {
      console.error(`[FileWatcher] ${sessionId}:`, err);
      void this.stop(sessionId);
    });

    this.watchers.set(sessionId, { watcher, pending: new Set(), timer: null });
  }

  private enqueue(sessionId: string, dir: string): void {
    const entry = this.watchers.get(sessionId);
    if (!entry) return;
    entry.pending.add(dir);
    if (entry.timer) return;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      const dirs = [...entry.pending];
      entry.pending.clear();
      if (dirs.length) this.onChange(sessionId, dirs);
    }, this.debounceMs);
    // Don't keep the process alive solely for a pending flush.
    entry.timer.unref?.();
  }

  /** Stop watching a session's folder. Safe to call for an unknown session. */
  async stop(sessionId: string): Promise<void> {
    const entry = this.watchers.get(sessionId);
    if (!entry) return;
    this.watchers.delete(sessionId);
    if (entry.timer) clearTimeout(entry.timer);
    entry.watcher.close();
  }

  /** Close all watchers — call on server shutdown. */
  async stopAll(): Promise<void> {
    await Promise.all([...this.watchers.keys()].map((id) => this.stop(id)));
  }

  /** Number of active watchers (for tests / diagnostics). */
  get size(): number {
    return this.watchers.size;
  }
}
