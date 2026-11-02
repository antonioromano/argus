/**
 * Names for the files settings export and import write. Pure, so they are
 * unit-tested; main.ts does the dialogs and the fs calls. The renderer never
 * supplies a path: main picks it through a dialog or the fixed backup folder.
 */

/** Automatic pre-import backups kept in userData/settings-backups. */
export const SETTINGS_BACKUPS_KEPT = 10;

const pad = (n: number) => String(n).padStart(2, '0');

/** Save dialog default: `argus-settings-YYYY-MM-DD.json`, local date. */
export function defaultExportName(now: Date): string {
  return `argus-settings-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/** Backup file name: the ISO instant with `:` and `.` made filename-safe, so
 *  names sort by time. */
export function backupFileName(now: Date): string {
  return `${now.toISOString().replace(/[:.]/g, '-')}.json`;
}

const BACKUP_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/;

/** Backup files to delete so only the newest `keep` remain. Anything in the
 *  folder that is not a backup name is left alone. */
export function backupsToPrune(names: readonly string[], keep: number = SETTINGS_BACKUPS_KEPT): string[] {
  const backups = names.filter((n) => BACKUP_NAME.test(n)).sort();
  return backups.slice(0, Math.max(0, backups.length - keep));
}
