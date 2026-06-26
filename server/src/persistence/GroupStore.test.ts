import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SessionGroup } from '@argus/shared';
import { GroupStore } from './GroupStore.js';

function tmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'argus-store-test-'));
}

const groups: SessionGroup[] = [
  {
    id: 'g1',
    name: 'Work',
    color: 'blue',
    collapsed: false,
    sessionIds: ['s1', 's2'],
  },
  {
    id: 'favorites',
    name: 'Favourites',
    color: 'gold',
    collapsed: true,
    sessionIds: ['s3'],
    entryMeta: { s3: { name: 'Pinned', folderPath: '/home/u/p', agentType: 'claude', flags: [] } },
  },
];

test('round-trips groups (including entryMeta) through save and load', async (t) => {
  const dir = tmpDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new GroupStore(path.join(dir, 'groups.json'));

  await store.save(groups);
  assert.deepEqual(await store.load(), groups);
});

test('returns [] when the file does not exist (no throw)', async (t) => {
  const dir = tmpDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new GroupStore(path.join(dir, 'missing.json'));

  assert.deepEqual(await store.load(), []);
});

test('returns [] when the backing file is corrupt JSON (no throw)', async (t) => {
  const dir = tmpDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'groups.json');
  writeFileSync(file, '{ not json', 'utf-8');
  const store = new GroupStore(file);

  assert.deepEqual(await store.load(), []);
});

test('save writes valid JSON to the final path with no leftover .tmp', async (t) => {
  const dir = tmpDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'nested', 'groups.json');
  const store = new GroupStore(file);

  await store.save(groups);

  const raw = await readFile(file, 'utf-8');
  assert.deepEqual((JSON.parse(raw) as SessionGroup[]).map((g) => g.id), ['g1', 'favorites']);
  const leftovers = readdirSync(path.dirname(file)).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});
