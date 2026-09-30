import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LauncherStore } from './LauncherStore.js';

const L = (id: string) => ({
  id, label: id, request: { agent: 'claude', folder: '/tmp', flags: [] },
  agentCommand: 'claude', folderConfigAtSave: [], createdAt: '2026-09-30T00:00:00.000Z',
});
const dir = (t: any) => { const d = mkdtempSync(path.join(os.tmpdir(), 'argus-ls-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };

test('missing file → empty list', async (t) => {
  assert.deepEqual(await new LauncherStore(path.join(dir(t), 'launchers.json')).load(), []);
});

test('round-trip', async (t) => {
  const s = new LauncherStore(path.join(dir(t), 'launchers.json'));
  await s.save([L('a'), L('b')]);
  assert.deepEqual((await s.load()).map((l) => l.id), ['a', 'b']);
});

test('drops malformed entries and non-array files', async (t) => {
  const d = dir(t);
  const f = path.join(d, 'launchers.json');
  writeFileSync(f, JSON.stringify([L('ok'), { id: 'BAD ID' }, { nope: 1 }]));
  assert.deepEqual((await new LauncherStore(f).load()).map((l) => l.id), ['ok']);
  writeFileSync(f, '{"not":"array"}');
  assert.deepEqual(await new LauncherStore(f).load(), []);
});
