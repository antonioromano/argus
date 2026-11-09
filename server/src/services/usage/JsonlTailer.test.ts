import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { nodeTranscriptFs } from './JsonlTailer.js';

test('nodeTranscriptFs lists a dir, returns [] for a missing dir, and stat carries mtimeMs', async () => {
  const d = mkdtempSync(path.join(tmpdir(), 'argus-tfs-'));
  writeFileSync(path.join(d, 'a.meta.json'), '{"x":1}');
  writeFileSync(path.join(d, 'b.jsonl'), 'line\n');

  assert.deepEqual((await nodeTranscriptFs.readdir(d)).sort(), ['a.meta.json', 'b.jsonl']);
  assert.deepEqual(await nodeTranscriptFs.readdir(path.join(d, 'nope')), []);
  assert.ok((await nodeTranscriptFs.stat(path.join(d, 'b.jsonl'))).mtimeMs > 0);
  assert.equal(await nodeTranscriptFs.readFile(path.join(d, 'a.meta.json')), '{"x":1}');
});
