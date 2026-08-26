import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAIN_WINDOW_ID, type WindowRegistryState } from '@argus/shared';
import { WindowStore } from '../persistence/WindowStore.js';
import { WindowRegistry } from './WindowRegistry.js';

async function makeRegistry(t: { after: (fn: () => void) => void }): Promise<WindowRegistry> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'argus-winreg-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const reg = new WindowRegistry(new WindowStore(path.join(dir, 'windows.json')));
  await reg.init();
  return reg;
}

test('init yields main window; ownerOf defaults to main', async (t) => {
  const reg = await makeRegistry(t);
  assert.equal(reg.getState().windows[0].id, MAIN_WINDOW_ID);
  assert.equal(reg.ownerOf('unknown-session'), MAIN_WINDOW_ID);
});

test('createWindow assigns optional session and labels sequentially', async (t) => {
  const reg = await makeRegistry(t);
  const w2 = await reg.createWindow('s1');
  assert.equal(w2.label, 'Window 2');
  assert.equal(reg.ownerOf('s1'), w2.id);
  const w3 = await reg.createWindow();
  assert.equal(w3.label, 'Window 3');
});

test('deleteWindow merges its sessions back to main; main is not deletable', async (t) => {
  const reg = await makeRegistry(t);
  const w2 = await reg.createWindow('s1');
  assert.equal(await reg.deleteWindow(w2.id), true);
  assert.equal(reg.ownerOf('s1'), MAIN_WINDOW_ID);
  assert.equal(reg.getState().windows.length, 1);
  assert.equal(await reg.deleteWindow(MAIN_WINDOW_ID), false);
  assert.equal(await reg.deleteWindow('nope'), false);
});

test('assign moves a session; assigning to main clears the entry; unknown window fails', async (t) => {
  const reg = await makeRegistry(t);
  const w2 = await reg.createWindow();
  assert.equal(await reg.assign('s1', w2.id), true);
  assert.equal(reg.ownerOf('s1'), w2.id);
  assert.equal(await reg.assign('s1', MAIN_WINDOW_ID), true);
  assert.deepEqual(reg.getState().assignments, {});
  assert.equal(await reg.assign('s1', 'nope'), false);
});

test('mergeAll pulls every session to the target and deletes emptied windows', async (t) => {
  const reg = await makeRegistry(t);
  const w2 = await reg.createWindow('s1');
  const w3 = await reg.createWindow('s2');
  const removed = await reg.mergeAll(w2.id, ['s1', 's2', 's3']);
  assert.deepEqual(removed, [w3.id]);
  assert.equal(reg.ownerOf('s1'), w2.id);
  assert.equal(reg.ownerOf('s2'), w2.id);
  assert.equal(reg.ownerOf('s3'), w2.id);
  // main survives even when empty
  assert.ok(reg.getState().windows.some((w) => w.id === MAIN_WINDOW_ID));
  assert.equal(await reg.mergeAll('nope', []), null);
});

test('mergeAll to main empties assignments entirely', async (t) => {
  const reg = await makeRegistry(t);
  const w2 = await reg.createWindow('s1');
  const removed = await reg.mergeAll(MAIN_WINDOW_ID, ['s1']);
  assert.deepEqual(removed, [w2.id]);
  assert.deepEqual(reg.getState().assignments, {});
});

test('removeSession and pruneToSessions drop assignments', async (t) => {
  const reg = await makeRegistry(t);
  const w2 = await reg.createWindow('s1');
  await reg.assign('s2', w2.id);
  await reg.removeSession('s1');
  assert.equal(reg.ownerOf('s1'), MAIN_WINDOW_ID);
  await reg.pruneToSessions(new Set([]));
  assert.deepEqual(reg.getState().assignments, {});
});

test('onChange fires with a snapshot on every mutation', async (t) => {
  const reg = await makeRegistry(t);
  const seen: WindowRegistryState[] = [];
  reg.onChange((s) => seen.push(s));
  const w2 = await reg.createWindow('s1');
  await reg.deleteWindow(w2.id);
  assert.equal(seen.length, 2);
  assert.equal(seen[1].windows.length, 1);
});

test('init prunes assignments referencing a window that no longer exists', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'argus-winreg-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'windows.json');
  const seeded: WindowRegistryState = {
    windows: [{ id: MAIN_WINDOW_ID, label: 'Main', isMain: true, createdAt: Date.now() }],
    assignments: { s1: 'nonexistent-window-id' },
  };
  await new WindowStore(file).save(seeded);

  const reg = new WindowRegistry(new WindowStore(file));
  await reg.init();
  assert.equal(reg.ownerOf('s1'), MAIN_WINDOW_ID);
  assert.deepEqual(reg.getState().assignments, {});

  // Pruning persisted, so a fresh load doesn't resurrect the stale assignment.
  const reg2 = new WindowRegistry(new WindowStore(file));
  await reg2.init();
  assert.deepEqual(reg2.getState().assignments, {});
});

test('state survives a reload through the store', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'argus-winreg-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'windows.json');
  const reg1 = new WindowRegistry(new WindowStore(file));
  await reg1.init();
  const w2 = await reg1.createWindow('s1');
  const reg2 = new WindowRegistry(new WindowStore(file));
  await reg2.init();
  assert.equal(reg2.ownerOf('s1'), w2.id);
  assert.equal(reg2.getState().windows.length, 2);
});

test('rename changes a window label and notifies; unknown window fails', async (t) => {
  const reg = await makeRegistry(t);
  const w2 = await reg.createWindow();
  const seen: WindowRegistryState[] = [];
  reg.onChange((s) => seen.push(s));
  assert.equal(await reg.rename(w2.id, 'Reviews'), true);
  assert.equal(reg.getState().windows.find((w) => w.id === w2.id)?.label, 'Reviews');
  assert.equal(seen.length, 1);
  assert.equal(await reg.rename('nope', 'X'), false);
});

test('promote dissolves the window into main: label transfers, sessions become default-owned', async (t) => {
  const reg = await makeRegistry(t);
  const w2 = await reg.createWindow('s1');
  await reg.rename(w2.id, 'Reviews');
  assert.equal(await reg.promote(w2.id), true);
  const state = reg.getState();
  assert.equal(state.windows.length, 1);
  assert.equal(state.windows[0].id, MAIN_WINDOW_ID);
  assert.equal(state.windows[0].label, 'Reviews');
  assert.equal(state.windows[0].isMain, true);
  assert.equal(reg.ownerOf('s1'), MAIN_WINDOW_ID);
});

test('promote refuses main itself and unknown windows; other secondaries untouched', async (t) => {
  const reg = await makeRegistry(t);
  const w2 = await reg.createWindow('s1');
  const w3 = await reg.createWindow('s2');
  assert.equal(await reg.promote(MAIN_WINDOW_ID), false);
  assert.equal(await reg.promote('nope'), false);
  assert.equal(await reg.promote(w2.id), true);
  // w3 and its assignment survive the promotion untouched.
  assert.equal(reg.ownerOf('s2'), w3.id);
  assert.ok(reg.getState().windows.some((w) => w.id === w3.id));
});

test('oldestSecondary picks the lowest createdAt; null when main is alone', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'argus-winreg-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'windows.json');
  const store = new WindowStore(file);
  await store.save({
    windows: [
      { id: MAIN_WINDOW_ID, label: 'Main', isMain: true, createdAt: 1 },
      { id: 'w-young', label: 'Window 3', isMain: false, createdAt: 300 },
      { id: 'w-old', label: 'Window 2', isMain: false, createdAt: 200 },
    ],
    assignments: {},
  });
  const reg = new WindowRegistry(store);
  await reg.init();
  assert.equal(reg.oldestSecondary()?.id, 'w-old');

  const solo = await makeRegistry(t);
  assert.equal(solo.oldestSecondary(), null);
});

test('rename works for the main window (label only, id fixed)', async (t) => {
  const reg = await makeRegistry(t);
  assert.equal(await reg.rename(MAIN_WINDOW_ID, 'Command Center'), true);
  const main = reg.getState().windows.find((w) => w.id === MAIN_WINDOW_ID);
  assert.equal(main?.label, 'Command Center');
  assert.equal(main?.isMain, true);
});
