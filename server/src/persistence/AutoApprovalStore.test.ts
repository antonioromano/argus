import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { AutoApprovalStore } from './AutoApprovalStore.js';
import { AUTO_APPROVAL_RULES_MAX } from '../constants/autoApproval.js';

const tmpFile = () => path.join(mkdtempSync(path.join(tmpdir(), 'argus-aastore-')), 'auto-approval.json');

test('missing file → no rules', async () => {
  const store = new AutoApprovalStore(tmpFile());
  await store.load();
  assert.deepEqual(store.rulesFor('/x'), []);
  assert.deepEqual(store.folderList(), []);
});

test('add / persist / reload / remove round-trip', async () => {
  const file = tmpFile();
  const store = new AutoApprovalStore(file);
  await store.load();
  const a = await store.addRule('/proj', { tool: 'Bash', bashPrefix: 'npm test' });
  const b = await store.addRule('/proj', { tool: 'Read', pathGlob: 'src/**' });
  assert.match(a.id, /^[a-f0-9-]{36}$/);

  const reloaded = new AutoApprovalStore(file);
  await reloaded.load();
  assert.deepEqual(reloaded.rulesFor('/proj').map((r) => r.id), [a.id, b.id]);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, 1);

  assert.equal(await reloaded.removeRule('/proj', a.id), true);
  assert.equal(await reloaded.removeRule('/proj', a.id), false);
  assert.equal(await reloaded.removeRule('/nope', b.id), false);
  assert.equal(await reloaded.removeRule('/proj', b.id), true);
  assert.deepEqual(reloaded.folderList(), [], 'empty folders are dropped');
  // Atomic write leaves no temp files behind.
  assert.deepEqual(readdirSync(path.dirname(file)).filter((f) => f.endsWith('.tmp')), []);
});

test('rulesFor returns a copy', async () => {
  const store = new AutoApprovalStore(tmpFile());
  await store.load();
  await store.addRule('/proj', { tool: 'Read', pathGlob: '**' });
  store.rulesFor('/proj').pop();
  assert.equal(store.rulesFor('/proj').length, 1);
});

test('tampered rules on disk are re-validated and dropped', async () => {
  const file = tmpFile();
  const ok = { id: '00000000-0000-4000-8000-000000000001', tool: 'Bash', bashPrefix: 'git status', createdAt: 'x' };
  writeFileSync(file, JSON.stringify({
    version: 1,
    folders: {
      '/proj': [
        ok,
        { id: '00000000-0000-4000-8000-000000000002', tool: 'Bash', bashPrefix: 'git status; rm -rf ~', createdAt: 'x' },
        { id: '00000000-0000-4000-8000-000000000003', tool: 'Bash', createdAt: 'x' },
        { id: '00000000-0000-4000-8000-000000000004', tool: 'Edit', pathGlob: '../**', createdAt: 'x' },
        { id: '00000000-0000-4000-8000-000000000005', tool: 'WebFetch', createdAt: 'x' },
        { id: 'not-a-uuid', tool: 'Read', createdAt: 'x' },
        null,
      ],
      'relative/folder': [ok],
    },
  }));
  const store = new AutoApprovalStore(file);
  await store.load();
  assert.deepEqual(store.rulesFor('/proj'), [ok]);
  assert.deepEqual(store.folderList(), ['/proj']);
});

test('corrupt file → no rules and a .bak copy', async () => {
  const file = tmpFile();
  writeFileSync(file, '{ not json');
  const store = new AutoApprovalStore(file);
  await store.load();
  assert.deepEqual(store.folderList(), []);
  assert.ok(existsSync(`${file}.bak`));
});

test('a folder is capped', async () => {
  const store = new AutoApprovalStore(tmpFile());
  await store.load();
  for (let i = 0; i < AUTO_APPROVAL_RULES_MAX; i++) await store.addRule('/proj', { tool: 'Bash', bashPrefix: `cmd${i}` });
  await assert.rejects(store.addRule('/proj', { tool: 'Bash', bashPrefix: 'one-more' }));
});

test('concurrent writes serialize and all land', async () => {
  const file = tmpFile();
  const store = new AutoApprovalStore(file);
  await store.load();
  await Promise.all([1, 2, 3, 4, 5].map((i) => store.addRule('/proj', { tool: 'Bash', bashPrefix: `c${i}` })));
  const reloaded = new AutoApprovalStore(file);
  await reloaded.load();
  assert.equal(reloaded.rulesFor('/proj').length, 5);
});
