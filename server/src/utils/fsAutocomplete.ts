import { readdir, stat } from 'fs/promises';
import path from 'path';
import os from 'os';

export async function getPathCompletions(partialPath: string): Promise<string[]> {
  // Resolve ~ to home directory
  const resolved = partialPath.startsWith('~')
    ? path.join(os.homedir(), partialPath.slice(1))
    : partialPath;

  const normalized = path.resolve(resolved);

  // Split into parent directory and partial name
  let parentDir: string;
  let partial: string;

  try {
    const stats = await stat(normalized);
    if (stats.isDirectory() && partialPath.endsWith('/')) {
      parentDir = normalized;
      partial = '';
    } else {
      parentDir = path.dirname(normalized);
      partial = path.basename(normalized);
    }
  } catch {
    parentDir = path.dirname(normalized);
    partial = path.basename(normalized);
  }

  try {
    const entries = await readdir(parentDir, { withFileTypes: true });
    const results: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Filter out hidden directories unless partial starts with .
      if (entry.name.startsWith('.') && !partial.startsWith('.')) continue;

      if (entry.name.toLowerCase().startsWith(partial.toLowerCase())) {
        results.push(path.join(parentDir, entry.name));
      }
    }

    return results.sort().slice(0, 20);
  } catch {
    return [];
  }
}
