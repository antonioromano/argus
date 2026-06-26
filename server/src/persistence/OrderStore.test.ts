import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OrderStore } from './OrderStore.js';

function tmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'argus-store-test-'));
}

test('round-trips the order array through save and load', async (t) => {
  const dir = tmpDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new OrderStore(path.join(dir, 'order.json'));

  const order = ['id-3', 'id-1', 'id-2'];
  await store.save(order);
  assert.deepEqual(await store.load(), order);
});

test('round-trips an empty order array', async (t) => {
  const dir = tmpDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new OrderStore(path.join(dir, 'order.json'));

  await store.save([]);
  assert.deepEqual(await store.load(), []);
});

test('returns [] when the file does not exist (no throw)', async (t) => {
  const dir = tmpDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new OrderStore(path.join(dir, 'missing.json'));

  assert.deepEqual(await store.load(), []);
});

test('returns [] when the backing file is corrupt JSON (no throw)', async (t) => {
  const dir = tmpDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'order.json');
  writeFileSync(file, '{ not json', 'utf-8');
  const store = new OrderStore(file);

  assert.deepEqual(await store.load(), []);
});

test('save writes valid JSON to the final path with no leftover .tmp', async (t) => {
  const dir = tmpDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'nested', 'order.json');
  const store = new OrderStore(file);

  await store.save(['x', 'y']);

  const raw = await readFile(file, 'utf-8');
  assert.deepEqual(JSON.parse(raw), ['x', 'y']);
  const leftovers = readdirSync(path.dirname(file)).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});
