import { readdir, stat } from 'fs/promises';
import path from 'path';
import os from 'os';

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', '__pycache__', 'dist', 'build',
  '.next', '.nuxt', '.cache', 'coverage', '.terraform',
]);

const EXCLUDED_FILE_EXTENSIONS = new Set(['.map', '.lock', '.log']);

export interface DirectoryEntry {
  name: string;
  path: string;
  hasChildren: boolean;
  isFile: boolean;
  ext: string;
  size?: number;
}

export async function getDirectoryChildren(dirPath?: string, includeFiles = false): Promise<{
  entries: DirectoryEntry[];
  parentPath: string;
}> {
  const resolved = dirPath
    ? (dirPath.startsWith('~') ? path.join(os.homedir(), dirPath.slice(1)) : path.resolve(dirPath))
    : os.homedir();

  try {
    const entries = await readdir(resolved, { withFileTypes: true });
    const dirs: DirectoryEntry[] = [];
    const files: DirectoryEntry[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.') && !includeFiles) continue;

      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;

        const fullPath = path.join(resolved, entry.name);
        let hasChildren = false;
        try {
          const children = await readdir(fullPath, { withFileTypes: true });
          hasChildren = children.some(c =>
            (c.isDirectory() && !EXCLUDED_DIRS.has(c.name)) ||
            (includeFiles && !c.isDirectory())
          );
        } catch { /* permission denied */ }

        dirs.push({ name: entry.name, path: fullPath, hasChildren, isFile: false, ext: '' });
      } else if (includeFiles && !entry.isDirectory()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (EXCLUDED_FILE_EXTENSIONS.has(ext)) continue;

        const fullPath = path.join(resolved, entry.name);
        let size: number | undefined;
        try {
          const s = await stat(fullPath);
          size = s.size;
        } catch { /* permission denied */ }

        files.push({ name: entry.name, path: fullPath, hasChildren: false, isFile: true, ext, size });
      }
    }

    const sortedDirs = dirs.sort((a, b) => a.name.localeCompare(b.name));
    const sortedFiles = files.sort((a, b) => a.name.localeCompare(b.name));
    const results = [...sortedDirs, ...sortedFiles].slice(0, 200);

    return { entries: results, parentPath: resolved };
  } catch {
    return { entries: [], parentPath: resolved };
  }
}
