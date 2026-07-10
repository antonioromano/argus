import chokidar, { type FSWatcher } from 'chokidar';
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
 * client can re-fetch just those folders. One chokidar watcher per session.
 *
 * Uses chokidar v4 (pure JS, no native fsevents dependency) to keep the
 * packaged app free of extra native binaries.
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

    const watcher = chokidar.watch(folderPath, {
      ignoreInitial: true,
      ignorePermissionErrors: true,
      // Ignore heavy/noise directories anywhere below the watched root. The
      // root itself (and anything outside it) is never ignored.
      ignored: (p: string) => {
        const rel = path.relative(folderPath, p);
        if (!rel || rel.startsWith('..')) return false;
        return rel.split(path.sep).some((seg) => EXCLUDED_DIRS.has(seg));
      },
    });

    const entry: WatchEntry = { watcher, pending: new Set(), timer: null };
    const onEvent = (changedPath: string) => this.enqueue(sessionId, path.dirname(changedPath));
    watcher
      .on('add', onEvent)
      .on('addDir', onEvent)
      .on('unlink', onEvent)
      .on('unlinkDir', onEvent)
      .on('error', (err) => console.error(`[FileWatcher] ${sessionId}:`, err));

    this.watchers.set(sessionId, entry);
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
    await entry.watcher.close();
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
