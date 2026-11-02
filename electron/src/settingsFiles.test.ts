import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupFileName, backupsToPrune, defaultExportName } from './settingsFiles.js';
import {
  isSettingsPayload, isLauncherImportItem, sanitizeLauncherImport, SETTINGS_PAYLOAD_MAX_BYTES, LAUNCHER_IMPORT_MAX,
} from './ipcGuards.js';

test('export name is argus-settings-YYYY-MM-DD.json in local time', () => {
  assert.equal(defaultExportName(new Date(2026, 9, 29, 23, 59)), 'argus-settings-2026-10-29.json');
});

test('backup names are filename-safe and sort by time', () => {
  const a = backupFileName(new Date('2026-10-29T10:00:00.000Z'));
  const b = backupFileName(new Date('2026-10-29T10:00:01.000Z'));
  assert.equal(a, '2026-10-29T10-00-00-000Z.json');
  assert.doesNotMatch(a, /[:/]/);
  assert.ok(a < b);
});

test('prune keeps the newest ten backups and ignores other files', () => {
  const names = Array.from({ length: 13 }, (_, i) => backupFileName(new Date(Date.UTC(2026, 0, 1, 0, 0, i))));
  const prune = backupsToPrune([...names].reverse().concat(['notes.txt', '.DS_Store']));
  assert.deepEqual(prune, names.slice(0, 3));
  assert.deepEqual(backupsToPrune(names.slice(0, 4)), []);
});

test('settings payload: a non-empty string of at most 1 MB', () => {
  assert.equal(isSettingsPayload('{}'), true);
  assert.equal(isSettingsPayload(''), false);
  assert.equal(isSettingsPayload(42), false);
  assert.equal(isSettingsPayload({ text: '{}' }), false);
  assert.equal(isSettingsPayload('x'.repeat(SETTINGS_PAYLOAD_MAX_BYTES + 1)), false);
  // Bytes, not characters: 400k three-byte characters is 1.2 MB.
  assert.equal(isSettingsPayload('€'.repeat(400_000)), false);
});

const item = (over: Record<string, unknown> = {}) => ({
  id: 'api', label: 'API', overwrite: false,
  request: { agent: 'claude', folder: '/Users/me/api', flags: ['--verbose'] },
  ...over,
});

test('launcher import item: shape checked, worktree refused', () => {
  assert.equal(isLauncherImportItem(item()), true);
  assert.equal(isLauncherImportItem(item({ id: 'Bad Id' })), false);
  assert.equal(isLauncherImportItem(item({ id: 'x'.repeat(41) })), false);
  assert.equal(isLauncherImportItem(item({ label: '  ' })), false);
  assert.equal(isLauncherImportItem(item({ overwrite: 'yes' })), false);
  assert.equal(isLauncherImportItem(item({ request: { agent: 'claude', folder: '/x', flags: [1] } })), false);
  assert.equal(isLauncherImportItem(item({ request: { agent: 'claude', folder: '/x', flags: [], worktree: 'feat' } })), false);
  assert.equal(isLauncherImportItem(item({ request: { agent: 'claude', folder: '/x', flags: [], engine: 'gpu' } })), false);
  assert.equal(isLauncherImportItem(null), false);
});

test('launcher import list: 1–100 distinct entries, unknown fields dropped', () => {
  assert.equal(sanitizeLauncherImport([]), null);
  assert.equal(sanitizeLauncherImport('x'), null);
  assert.equal(sanitizeLauncherImport([item(), item()]), null);
  const many = Array.from({ length: LAUNCHER_IMPORT_MAX + 1 }, (_, i) => item({ id: `l${i}` }));
  assert.equal(sanitizeLauncherImport(many), null);
  assert.equal(sanitizeLauncherImport(many.slice(0, LAUNCHER_IMPORT_MAX))?.length, LAUNCHER_IMPORT_MAX);
  const [clean] = sanitizeLauncherImport([{ ...item(), agentCommand: '/bin/sh', request: { ...item().request, extra: 1 } }])!;
  assert.deepEqual(clean, item());
});
