import { mkdir, rename as fsRename, rm, lstat, readdir } from 'fs/promises';
import { randomUUID } from 'crypto';
import path from 'path';

/** How long a deleted file waits in the trash before it is purged for good. */
export const STAGED_TRASH_TTL_MS = 60_000;

interface Entry {
  origin: string;
  sessionId: string;
  /** `<dir>/<undoId>` — the staged item sits inside it under its own basename. */
  slot: string;
  timer: ReturnType<typeof setTimeout>;
}

export type RestoreResult =
  | { ok: true; path: string }
  | { ok: false; status: number; error: string };

export interface StagedTrashOptions {
  ttlMs?: number;
  /** Injectable for tests (EXDEV across volumes). */
  rename?: (from: string, to: string) => Promise<void>;
}

/**
 * In-app trash behind Explorer delete (plan 004 U7). A delete renames the item
 * into `<dataDir>/trash/<undoId>/<basename>` — O(1) even for a big folder —
 * and Undo renames it back. Entries are purged after `ttlMs` (longer than the
 * 10 s toast) and the whole dir is swept at startup, so nothing outlives a
 * restart. A rename across volumes throws EXDEV: the route then falls back to
 * the old "cannot be undone" delete.
 *
 * Restores are scoped: only the session that deleted the item can restore it,
 * only to the path it came from, only while that path is still inside the
 * session's work root (`resolveOrigin`) and nothing has been created there since.
 */
export class StagedTrash {
  private readonly entries = new Map<string, Entry>();
  /** Slots made by this run, recorded before their folder exists. The startup
   *  sweep runs while the delete route is already live and must not take them. */
  private readonly ownSlots = new Set<string>();
  private readonly ttlMs: number;
  private readonly rename: (from: string, to: string) => Promise<void>;

  constructor(private readonly dir: string, opts: StagedTrashOptions = {}) {
    this.ttlMs = opts.ttlMs ?? STAGED_TRASH_TTL_MS;
    this.rename = opts.rename ?? fsRename;
  }

  /** Startup: anything left in the trash is from a previous run and unrestorable.
   *  Slots this run staged meanwhile are skipped. */
  async sweep(): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return;
    }
    await Promise.all(names.filter((n) => !this.ownSlots.has(n)).map((n) => rm(path.join(this.dir, n), { recursive: true, force: true }).catch(() => {})));
  }

  /** Moves `absPath` into the trash and returns its undo id. Rethrows the
   *  rename error (EXDEV across volumes, ENOENT, EACCES) with the slot cleaned up. */
  async stage(absPath: string, sessionId: string): Promise<string> {
    const undoId = randomUUID();
    this.ownSlots.add(undoId);
    const slot = path.join(this.dir, undoId);
    await mkdir(slot, { recursive: true });
    try {
      await this.rename(absPath, path.join(slot, path.basename(absPath)));
    } catch (err) {
      await rm(slot, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
    const timer = setTimeout(() => { void this.purge(undoId); }, this.ttlMs);
    timer.unref?.();
    this.entries.set(undoId, { origin: absPath, sessionId, slot, timer });
    return undoId;
  }

  /**
   * Puts a staged item back. `resolveOrigin` re-checks the original path against
   * the session's scope now (the session may be gone, or its root may have
   * moved); it returns the resolved path or null.
   */
  async restore(undoId: string, sessionId: string, resolveOrigin: (origin: string) => string | null): Promise<RestoreResult> {
    const entry = this.entries.get(undoId);
    if (!entry) return { ok: false, status: 404, error: 'Undo window expired or not found' };
    if (entry.sessionId !== sessionId) return { ok: false, status: 403, error: 'This delete belongs to another session' };
    const target = resolveOrigin(entry.origin);
    if (!target || target !== entry.origin) {
      return { ok: false, status: 403, error: 'The original location is outside the session folder' };
    }
    if (await exists(target)) {
      return { ok: false, status: 409, error: `Something new already exists at ${path.basename(target)}` };
    }
    try {
      await this.rename(path.join(entry.slot, path.basename(entry.origin)), target);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const error = code === 'ENOENT' ? 'The folder it was in no longer exists' : (err as Error).message;
      return { ok: false, status: code === 'ENOENT' ? 409 : 500, error };
    }
    clearTimeout(entry.timer);
    this.entries.delete(undoId);
    await rm(entry.slot, { recursive: true, force: true }).catch(() => {});
    return { ok: true, path: target };
  }

  /** Deletes a staged item for good. */
  async purge(undoId: string): Promise<void> {
    const entry = this.entries.get(undoId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.entries.delete(undoId);
    await rm(entry.slot, { recursive: true, force: true }).catch(() => {});
  }

  /** Purges every staged item now (server shutdown). */
  async purgeAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((id) => this.purge(id)));
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await lstat(p);
    return true;
  } catch {
    return false;
  }
}
