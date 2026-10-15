import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TemplateStore } from './TemplateStore.js';

const T = (id: string) => ({
  id, name: id, specs: [{ agent: 'claude', folder: '/tmp' }],
  createdAt: '2026-10-15T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z',
});
const dir = (t: any) => { const d = mkdtempSync(path.join(os.tmpdir(), 'argus-ts-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };

test('missing file → empty list', async (t) => {
  assert.deepEqual(await new TemplateStore(path.join(dir(t), 'templates.json')).load(), []);
});

test('round-trip through an atomic write, no temp files left behind', async (t) => {
  const d = dir(t);
  const s = new TemplateStore(path.join(d, 'templates.json'));
  await s.save([T('a'), T('b')]);
  assert.deepEqual((await s.load()).map((x) => x.id), ['a', 'b']);
  const { readdirSync } = await import('node:fs');
  assert.deepEqual(readdirSync(d), ['templates.json']);
});

test('drops malformed entries and non-array files', async (t) => {
  const f = path.join(dir(t), 'templates.json');
  writeFileSync(f, JSON.stringify([T('ok'), { id: 'x', name: 'x', specs: [{ agent: 1 }] }, { id: '', name: 'y', specs: [] }, null]));
  assert.deepEqual((await new TemplateStore(f).load()).map((x) => x.id), ['ok']);
  writeFileSync(f, '{"not":"array"}');
  assert.deepEqual(await new TemplateStore(f).load(), []);
});

test('unparseable file is backed up before it can be overwritten', async (t) => {
  const f = path.join(dir(t), 'templates.json');
  writeFileSync(f, '{oops');
  assert.deepEqual(await new TemplateStore(f).load(), []);
  assert.ok(existsSync(`${f}.bak`));
  assert.equal(readFileSync(`${f}.bak`, 'utf-8'), '{oops');
});
