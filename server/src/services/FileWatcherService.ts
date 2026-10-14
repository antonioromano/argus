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

interface RootEntry {
  root: string;
  watcher: FSWatcher;
  /** Sessions sharing this root's watcher (the refcount). */
  subscribers: Set<string>;
  /** Parent dirs of changed entries, accumulated between debounce flushes. */
  pending: Set<string>;
  timer: NodeJS.Timeout | null;
}

/**
 * Watches each session's folder for filesystem changes and reports the
 * (debounced, de-duplicated) set of parent directories that changed, so the
 * client can re-fetch just those folders.
 *
 * One native recursive watcher per ROOT, refcounted across the sessions that
 * use it: N sessions on the same folder (the common case — several agents on
 * one repo) share one FSEvents stream, one exclusion filter pass per event and
 * one debounce timer, and each is told about the same flush. The watcher closes
 * when its last session stops.
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
  private readonly roots = new Map<string, RootEntry>();
  /** sessionId → the root it subscribes to. */
  private readonly sessions = new Map<string, string>();

  constructor(
    private readonly onChange: FsChangeHandler,
    private readonly debounceMs: number = DEFAULT_DEBOUNCE_MS,
  ) {}

  /** Start watching a session's folder. No-op if already watching it. */
  watch(sessionId: string, folderPath: string): void {
    if (this.sessions.has(sessionId)) return;
    const root = path.resolve(folderPath);

    const existing = this.roots.get(root);
    if (existing) {
      existing.subscribers.add(sessionId);
      this.sessions.set(sessionId, root);
      return;
    }

    let watcher: FSWatcher;
    const armedAt = Date.now();
    try {
      watcher = fsWatch(root, { recursive: true }, (_event, filename) => {
        if (Date.now() - armedAt < ARMING_GRACE_MS) return;
        if (!filename) {
          // Rare overflow/unknown-path case — refresh the root.
          this.enqueue(root, root);
          return;
        }
        const rel = filename.toString();
        if (rel.split(path.sep).some((seg) => EXCLUDED_DIRS.has(seg))) return;
        this.enqueue(root, path.dirname(path.join(root, rel)));
      });
    } catch (err) {
      console.error(`[FileWatcher] ${sessionId}: failed to watch ${root}:`, err);
      return;
    }

    const entry: RootEntry = { root, watcher, subscribers: new Set([sessionId]), pending: new Set(), timer: null };
    watcher.on('error', (err) => {
      console.error(`[FileWatcher] ${root}:`, err);
      this.closeRoot(entry);
    });

    this.roots.set(root, entry);
    this.sessions.set(sessionId, root);
  }

  private enqueue(root: string, dir: string): void {
    const entry = this.roots.get(root);
    if (!entry) return;
    entry.pending.add(dir);
    if (entry.timer) return;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      const dirs = [...entry.pending];
      entry.pending.clear();
      if (!dirs.length) return;
      for (const sessionId of [...entry.subscribers]) this.onChange(sessionId, dirs);
    }, this.debounceMs);
    // Don't keep the process alive solely for a pending flush.
    entry.timer.unref?.();
  }

  /** Close a root's watcher and forget every session that shared it. */
  private closeRoot(entry: RootEntry): void {
    if (this.roots.get(entry.root) !== entry) return;
    this.roots.delete(entry.root);
    for (const id of entry.subscribers) {
      if (this.sessions.get(id) === entry.root) this.sessions.delete(id);
    }
    entry.subscribers.clear();
    if (entry.timer) clearTimeout(entry.timer);
    entry.watcher.close();
  }

  /** Stop watching a session's folder. Safe to call for an unknown session. */
  async stop(sessionId: string): Promise<void> {
    const root = this.sessions.get(sessionId);
    if (root === undefined) return;
    this.sessions.delete(sessionId);
    const entry = this.roots.get(root);
    if (!entry) return;
    entry.subscribers.delete(sessionId);
    if (entry.subscribers.size === 0) this.closeRoot(entry);
  }

  /** Close all watchers — call on server shutdown. */
  async stopAll(): Promise<void> {
    for (const entry of [...this.roots.values()]) this.closeRoot(entry);
    this.sessions.clear();
  }

  /** Number of watched sessions (for tests / diagnostics). */
  get size(): number {
    return this.sessions.size;
  }

  /** Number of native watchers open — one per distinct root. */
  get rootCount(): number {
    return this.roots.size;
  }
}
