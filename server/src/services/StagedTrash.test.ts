import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'fs';
import { StagedTrash } from './StagedTrash.js';

function setup() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'argus-trash-'));
  const project = path.join(tmp, 'project');
  const trashDir = path.join(tmp, 'data', 'trash');
  mkdirSync(project, { recursive: true });
  const inScope = (p: string) => (p.startsWith(project + path.sep) ? p : null);
  return { tmp, project, trashDir, inScope, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

test('stage + restore round-trips a file', async () => {
  const { project, trashDir, inScope, cleanup } = setup();
  try {
    const trash = new StagedTrash(trashDir);
    const file = path.join(project, 'a.txt');
    writeFileSync(file, 'hello');
    const id = await trash.stage(file, 's1');
    assert.equal(existsSync(file), false);
    const r = await trash.restore(id, 's1', inScope);
    assert.deepEqual(r, { ok: true, path: file });
    assert.equal(readFileSync(file, 'utf8'), 'hello');
    assert.deepEqual(readdirSync(trashDir), [], 'slot cleaned up');
    await trash.purgeAll();
  } finally { cleanup(); }
});

test('stage + restore round-trips a folder with its contents', async () => {
  const { project, trashDir, inScope, cleanup } = setup();
  try {
    const trash = new StagedTrash(trashDir);
    const dir = path.join(project, 'src');
    mkdirSync(path.join(dir, 'deep'), { recursive: true });
    writeFileSync(path.join(dir, 'deep', 'x.ts'), 'x');
    const id = await trash.stage(dir, 's1');
    assert.equal(existsSync(dir), false);
    assert.equal((await trash.restore(id, 's1', inScope)).ok, true);
    assert.equal(readFileSync(path.join(dir, 'deep', 'x.ts'), 'utf8'), 'x');
    await trash.purgeAll();
  } finally { cleanup(); }
});

test('another session cannot restore it', async () => {
  const { project, trashDir, inScope, cleanup } = setup();
  try {
    const trash = new StagedTrash(trashDir);
    const file = path.join(project, 'a.txt');
    writeFileSync(file, 'x');
    const id = await trash.stage(file, 's1');
    const r = await trash.restore(id, 's2', inScope);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 403);
    assert.equal(existsSync(file), false);
    assert.equal((await trash.restore(id, 's1', inScope)).ok, true, 'still restorable by its own session');
    await trash.purgeAll();
  } finally { cleanup(); }
});

test('a path that now resolves outside the session scope is refused', async () => {
  const { project, trashDir, cleanup } = setup();
  try {
    const trash = new StagedTrash(trashDir);
    const file = path.join(project, 'a.txt');
    writeFileSync(file, 'x');
    const id = await trash.stage(file, 's1');
    const r = await trash.restore(id, 's1', () => null);
    assert.equal(!r.ok && r.status, 403);
    assert.equal(existsSync(file), false);
    await trash.purgeAll();
  } finally { cleanup(); }
});

test('restore over a re-created path is refused and leaves the new file alone', async () => {
  const { project, trashDir, inScope, cleanup } = setup();
  try {
    const trash = new StagedTrash(trashDir);
    const file = path.join(project, 'a.txt');
    writeFileSync(file, 'old');
    const id = await trash.stage(file, 's1');
    writeFileSync(file, 'new');
    const r = await trash.restore(id, 's1', inScope);
    assert.equal(!r.ok && r.status, 409);
    assert.equal(readFileSync(file, 'utf8'), 'new');
    await trash.purgeAll();
  } finally { cleanup(); }
});

test('entries are purged after the TTL and then cannot be restored', async () => {
  const { project, trashDir, inScope, cleanup } = setup();
  try {
    const trash = new StagedTrash(trashDir, { ttlMs: 20 });
    const file = path.join(project, 'a.txt');
    writeFileSync(file, 'x');
    const id = await trash.stage(file, 's1');
    await new Promise((r) => setTimeout(r, 80));
    assert.deepEqual(readdirSync(trashDir), []);
    const r = await trash.restore(id, 's1', inScope);
    assert.equal(!r.ok && r.status, 404);
    assert.equal(existsSync(file), false);
  } finally { cleanup(); }
});

test('a rename across volumes (EXDEV) is rethrown and leaves the file in place', async () => {
  const { project, trashDir, cleanup } = setup();
  try {
    const exdev = Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' });
    const trash = new StagedTrash(trashDir, { rename: async () => { throw exdev; } });
    const file = path.join(project, 'a.txt');
    writeFileSync(file, 'x');
    await assert.rejects(trash.stage(file, 's1'), (e: NodeJS.ErrnoException) => e.code === 'EXDEV');
    assert.equal(existsSync(file), true);
    assert.deepEqual(readdirSync(trashDir), [], 'no empty slot left behind');
  } finally { cleanup(); }
});

test('sweep empties the trash left by a previous run', async () => {
  const { trashDir, cleanup } = setup();
  try {
    mkdirSync(path.join(trashDir, 'old-id'), { recursive: true });
    writeFileSync(path.join(trashDir, 'old-id', 'f'), 'x');
    await new StagedTrash(trashDir).sweep();
    assert.deepEqual(readdirSync(trashDir), []);
    await new StagedTrash(path.join(trashDir, 'missing')).sweep(); // no dir: no throw
  } finally { cleanup(); }
});

test('the startup sweep leaves an item this run staged meanwhile restorable', async () => {
  // index.ts starts the sweep without awaiting it, with the delete route
  // already live: a delete staged during the sweep must survive it.
  const { project, trashDir, inScope, cleanup } = setup();
  try {
    mkdirSync(path.join(trashDir, 'old-id'), { recursive: true });
    const trash = new StagedTrash(trashDir);
    const file = path.join(project, 'b.txt');
    writeFileSync(file, 'keep');
    const id = await trash.stage(file, 's1');
    await trash.sweep();
    assert.deepEqual(readdirSync(trashDir), [id], 'the old slot went, the new one stayed');
    assert.deepEqual(await trash.restore(id, 's1', inScope), { ok: true, path: file });
    assert.equal(readFileSync(file, 'utf8'), 'keep');
    await trash.purgeAll();
  } finally { cleanup(); }
});
