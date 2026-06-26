import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SessionStore, type PersistedSession } from './SessionStore.js';

function tmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'argus-store-test-'));
}

const sample: PersistedSession[] = [
  {
    id: 'a1',
    name: 'Session One',
    folderPath: '/home/u/project',
    createdAt: '2026-01-01T00:00:00.000Z',
    agentType: 'claude',
    flags: ['--verbose'],
    worktreePath: '/home/u/project-wt',
    worktreeBranch: 'feature/x',
  },
  {
    id: 'b2',
    name: 'Session Two',
    folderPath: '/home/u/other',
    createdAt: '2026-01-02T00:00:00.000Z',
    agentType: 'codex',
    flags: [],
  },
];

test('round-trips sessions through save and load', async (t) => {
  const dir = tmpDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new SessionStore(path.join(dir, 'sessions.json'));

  await store.save(sample);
  const loaded = await store.load();

  // worktreePath/worktreeBranch are spread back as undefined when absent,
  // so compare against the normalized expectation the loader produces.
  assert.deepEqual(loaded, [
    { ...sample[0] },
    { ...sample[1], worktreePath: undefined, worktreeBranch: undefined },
  ]);
});

test('returns [] when the file does not exist (no throw)', async (t) => {
  const dir = tmpDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new SessionStore(path.join(dir, 'does-not-exist.json'));

  const loaded = await store.load();
  assert.deepEqual(loaded, []);
});

test('returns [] when the backing file is corrupt JSON (no throw)', async (t) => {
  const dir = tmpDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'sessions.json');
  writeFileSync(file, '{ not json', 'utf-8');
  const store = new SessionStore(file);

  const loaded = await store.load();
  assert.deepEqual(loaded, []);
});

test('returns [] when the file is valid JSON but not an array (no throw)', async (t) => {
  // NOTE: load() calls parsed.map(...). When the file holds valid JSON that is
  // not an array (e.g. an object dumped by an older/buggy writer), .map throws
  // a TypeError which the catch swallows into []. So this is handled today, but
  // it relies on the catch-all rather than an explicit Array.isArray guard —
  // a potential hardening gap if the map() logic ever changes.
  const dir = tmpDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'sessions.json');
  writeFileSync(file, '{"oops": true}', 'utf-8');
  const store = new SessionStore(file);

  const loaded = await store.load();
  assert.deepEqual(loaded, []);
});

test('backfills agentType and flags for legacy records missing them', async (t) => {
  const dir = tmpDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'sessions.json');
  // Legacy record predating multi-agent + flags support.
  writeFileSync(
    file,
    JSON.stringify([{ id: 'old', name: 'Legacy', folderPath: '/x', createdAt: '2025-01-01T00:00:00.000Z' }]),
    'utf-8',
  );
  const store = new SessionStore(file);

  const loaded = await store.load();
  assert.equal(loaded[0].agentType, 'claude');
  assert.deepEqual(loaded[0].flags, []);
});

test('save writes valid JSON to the final path (atomic temp+rename leaves no .tmp)', async (t) => {
  const dir = tmpDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'nested', 'sessions.json');
  const store = new SessionStore(file);

  await store.save(sample);

  // Final file exists and is parseable.
  const raw = await readFile(file, 'utf-8');
  assert.deepEqual(JSON.parse(raw).map((s: PersistedSession) => s.id), ['a1', 'b2']);

  // No leftover temp file in the directory.
  const { readdirSync } = await import('node:fs');
  const leftovers = readdirSync(path.dirname(file)).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
  assert.ok(existsSync(file));
});
