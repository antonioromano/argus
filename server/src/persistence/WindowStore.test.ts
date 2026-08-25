import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAIN_WINDOW_ID, type WindowRegistryState } from '@argus/shared';
import { WindowStore } from './WindowStore.js';

function tmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'argus-winstore-test-'));
}

const state: WindowRegistryState = {
  windows: [
    { id: MAIN_WINDOW_ID, label: 'Main', isMain: true, createdAt: 1 },
    { id: 'w2', label: 'Window 2', isMain: false, createdAt: 2 },
  ],
  assignments: { s1: 'w2' },
};

test('round-trips state through save and load', async (t) => {
  const dir = tmpDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new WindowStore(path.join(dir, 'windows.json'));
  await store.save(state);
  assert.deepEqual(await store.load(), state);
});

test('missing file yields default state with main window only', async (t) => {
  const dir = tmpDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new WindowStore(path.join(dir, 'missing.json'));
  const loaded = await store.load();
  assert.equal(loaded.windows.length, 1);
  assert.equal(loaded.windows[0].id, MAIN_WINDOW_ID);
  assert.equal(loaded.windows[0].isMain, true);
  assert.deepEqual(loaded.assignments, {});
});

test('corrupt JSON yields default state (no throw)', async (t) => {
  const dir = tmpDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'windows.json');
  writeFileSync(file, '{ not json', 'utf-8');
  const store = new WindowStore(file);
  const loaded = await store.load();
  assert.equal(loaded.windows[0].id, MAIN_WINDOW_ID);
});

test('load tolerates a file missing fields (partial JSON object)', async (t) => {
  const dir = tmpDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'windows.json');
  writeFileSync(file, '{}', 'utf-8');
  const store = new WindowStore(file);
  const loaded = await store.load();
  assert.equal(loaded.windows[0].id, MAIN_WINDOW_ID);
  assert.deepEqual(loaded.assignments, {});
});
