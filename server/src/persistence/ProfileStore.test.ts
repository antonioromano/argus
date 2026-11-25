import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { ProfileStore } from './ProfileStore.js';

function tmp(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'argus-profiles-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'profiles.json');
}

test('a missing file loads as no profiles, prompt pending', async (t) => {
  assert.deepEqual(await new ProfileStore(tmp(t)).load(), { activeId: null, profiles: [], prompt: 'pending' });
});

test('round-trips and leaves no temp files', async (t) => {
  const file = tmp(t);
  const store = new ProfileStore(file);
  const state = { activeId: 'a', profiles: [{ id: 'a', name: 'Me', avatar: '🦉', createdAt: 5, settings: { density: 'compact' as const } }], prompt: 'done' as const };
  await store.save(state);
  assert.deepEqual(await store.load(), state);
  assert.deepEqual(readdirSync(path.dirname(file)), ['profiles.json']);
});

test('an unparseable file loads empty and is backed up first', async (t) => {
  const file = tmp(t);
  writeFileSync(file, '{ not json');
  assert.deepEqual((await new ProfileStore(file).load()).profiles, []);
  assert.ok(existsSync(`${file}.bak`));
});
