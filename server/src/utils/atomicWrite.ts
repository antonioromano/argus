import { writeFile, rename, mkdir } from 'fs/promises';
import { randomUUID } from 'crypto';
import path from 'path';

/**
 * Atomically write data to filePath by writing to a temp file first,
 * then renaming. Prevents corruption if the process crashes mid-write.
 */
export async function atomicWrite(filePath: string, data: string): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(tmpPath, data, 'utf-8');
  await rename(tmpPath, filePath);
}
