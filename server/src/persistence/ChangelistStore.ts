import { createHash } from 'crypto';
import os from 'os';
import path from 'path';
import { readFile } from 'fs/promises';
import { execFileSync } from 'child_process';
import { atomicWrite } from '../utils/atomicWrite.js';
import type { ChangelistStateResponse } from '@argus/shared';

// Resolve the git binary path once at startup.
const GIT_PATH = (() => {
  try {
    return execFileSync('which', ['git'], { encoding: 'utf-8' }).trim();
  } catch {
    return 'git';
  }
})();

const DEFAULT_STATE: ChangelistStateResponse = {
  version: 1,
  activeId: 'default',
  lists: [{ id: 'default', name: 'Changes', isDefault: true, fileKeys: [] }],
};

/**
 * Resolves the git repository root for a given folder path.
 * Falls back to folderPath itself when not inside a git repository.
 */
function getGitRoot(folderPath: string): string {
  try {
    return execFileSync(GIT_PATH, ['rev-parse', '--show-toplevel'], {
      cwd: folderPath,
      encoding: 'utf-8',
    }).trim();
  } catch {
    return folderPath;
  }
}

/**
 * Returns the path to the changelist state file for the given git root.
 * The path is scoped to ~/.argus/data/<sha256(gitRoot)>/changelists.json
 * so each repository gets its own isolated state.
 */
function stateFilePath(gitRoot: string): string {
  const hash = createHash('sha256').update(gitRoot).digest('hex');
  return path.join(os.homedir(), '.argus', 'data', hash, 'changelists.json');
}

// Serialize writes per gitRoot to prevent concurrent corruption.
// Each queue entry is a promise that resolves after the last queued write completes.
const writeQueues = new Map<string, Promise<void>>();

export class ChangelistStore {
  /**
   * Loads the changelist state for the repository containing folderPath.
   * Returns a fresh DEFAULT_STATE if no persisted state exists.
   */
  async load(folderPath: string): Promise<ChangelistStateResponse> {
    const gitRoot = getGitRoot(folderPath);
    const filePath = stateFilePath(gitRoot);

    try {
      const data = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data) as ChangelistStateResponse;

      // Ensure the default list always exists even in older saved states.
      if (!parsed.lists.find(l => l.isDefault)) {
        parsed.lists.unshift({ id: 'default', name: 'Changes', isDefault: true, fileKeys: [] });
      }

      return parsed;
    } catch {
      // File doesn't exist or is corrupt — return a fresh default state.
      return {
        ...DEFAULT_STATE,
        lists: [{ ...DEFAULT_STATE.lists[0] }],
      };
    }
  }

  /**
   * Persists the changelist state for the repository containing folderPath.
   * Writes are serialized per-repository to prevent interleaved concurrent writes.
   */
  async save(folderPath: string, state: ChangelistStateResponse): Promise<void> {
    const gitRoot = getGitRoot(folderPath);
    const filePath = stateFilePath(gitRoot);

    // Chain this write onto the tail of the existing queue for this repo.
    const queue = writeQueues.get(gitRoot) ?? Promise.resolve();
    const next = queue.then(() => atomicWrite(filePath, JSON.stringify(state, null, 2)));

    // Suppress unhandled rejection from the queue slot — the caller's await will surface errors.
    writeQueues.set(gitRoot, next.catch(() => {}));

    await next;
  }
}
