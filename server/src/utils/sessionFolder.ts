import { realpath, stat } from 'fs/promises';
import path from 'path';

/**
 * Canonical folder for a NEW session. The folder is the root of the session's
 * pathScope sandbox (every fs/git route is contained to it), so it must be
 * exactly the directory the user meant:
 * - absolute — a relative path resolved against the server's cwd (often $HOME
 *   or `/` in the packaged app) and silently widened the sandbox;
 * - realpath'd — a symlink (or `..` segments) stored verbatim made the stored
 *   root disagree with the realpath checks pathScope runs on every request;
 * - a directory — a file or missing path only failed later, at spawn.
 */
export async function resolveSessionFolder(folderPath: unknown): Promise<string> {
  if (typeof folderPath !== 'string' || !folderPath || !path.isAbsolute(folderPath)) {
    throw new Error('folderPath must be an absolute path');
  }
  let real: string;
  try {
    real = await realpath(path.resolve(folderPath));
  } catch {
    throw new Error(`Folder does not exist: ${folderPath}`);
  }
  if (!(await stat(real)).isDirectory()) throw new Error(`Not a directory: ${folderPath}`);
  return real;
}
