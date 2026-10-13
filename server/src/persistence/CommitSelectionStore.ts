import { createHash } from 'crypto';
import os from 'os';
import path from 'path';
import { readFile } from 'fs/promises';
import { atomicWrite } from '../utils/atomicWrite.js';
import { resolveGitRoot } from '../utils/gitRoot.js';
import type { CommitSelectionState } from '@argus/shared';

const DEFAULT_STATE: CommitSelectionState = { version: 1, files: [] };

function stateFilePath(gitRoot: string): string {
  const hash = createHash('sha256').update(gitRoot).digest('hex');
  return path.join(os.homedir(), '.argus', 'data', hash, 'commit-selection.json');
}

const writeQueues = new Map<string, Promise<void>>();

export class CommitSelectionStore {
  async load(folderPath: string): Promise<CommitSelectionState> {
    // Cached + async (utils/gitRoot): no blocking git fork per request.
    const gitRoot = await resolveGitRoot(folderPath);
    const filePath = stateFilePath(gitRoot);

    try {
      const data = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data) as CommitSelectionState;
      if (parsed?.version === 1 && Array.isArray(parsed.files)) {
        return parsed;
      }
      return { ...DEFAULT_STATE, files: [] };
    } catch {
      return { ...DEFAULT_STATE, files: [] };
    }
  }

  async save(folderPath: string, state: CommitSelectionState): Promise<void> {
    // Cached + async (utils/gitRoot): no blocking git fork per request.
    const gitRoot = await resolveGitRoot(folderPath);
    const filePath = stateFilePath(gitRoot);

    const queue = writeQueues.get(gitRoot) ?? Promise.resolve();
    const next = queue.then(() => atomicWrite(filePath, JSON.stringify(state, null, 2)));
    writeQueues.set(gitRoot, next.catch(() => {}));

    await next;
  }
}
