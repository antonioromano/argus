import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChainStore } from './ChainStore.js';

const C = (id: string) => ({
  id, sourceId: 'a', targetId: 'b', trigger: 'idle', mode: 'once', prompt: 'go', armed: true,
  createdAt: '2026-10-15T00:00:00.000Z', fireCount: 0,
});
const dir = (t: any) => { const d = mkdtempSync(path.join(os.tmpdir(), 'argus-cs-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };

test('missing file → empty list', async (t) => {
  assert.deepEqual(await new ChainStore(path.join(dir(t), 'chains.json')).load(), []);
});

test('round-trip through an atomic write, no temp files left behind', async (t) => {
  const d = dir(t);
  const s = new ChainStore(path.join(d, 'chains.json'));
  await s.save([C('a'), C('b')] as never);
  assert.deepEqual((await s.load()).map((x) => x.id), ['a', 'b']);
  assert.deepEqual(readdirSync(d), ['chains.json']);
});

test('drops malformed entries (self-chain, bad trigger, empty prompt) and non-array files', async (t) => {
  const f = path.join(dir(t), 'chains.json');
  writeFileSync(f, JSON.stringify([
    C('ok'),
    { ...C('self'), targetId: 'a' },
    { ...C('trig'), trigger: 'running' },
    { ...C('mode'), mode: 'forever' },
    { ...C('prompt'), prompt: '' },
    { ...C('nocount'), fireCount: 'x' },
    null,
  ]));
  const loaded = await new ChainStore(f).load();
  assert.deepEqual(loaded.map((x) => x.id), ['ok', 'nocount']);
  assert.equal(loaded[1].fireCount, 0);
  writeFileSync(f, '{"not":"array"}');
  assert.deepEqual(await new ChainStore(f).load(), []);
});

test('unparseable file is backed up before it can be overwritten', async (t) => {
  const f = path.join(dir(t), 'chains.json');
  writeFileSync(f, '{oops');
  assert.deepEqual(await new ChainStore(f).load(), []);
  assert.ok(existsSync(`${f}.bak`));
  assert.equal(readFileSync(`${f}.bak`, 'utf-8'), '{oops');
});
