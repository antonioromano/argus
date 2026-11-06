import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveClientDist } from './clientDist.js';

const packed = '/Applications/Argus.app/Contents/Resources/app.asar/client/dist';
const unpacked = '/Applications/Argus.app/Contents/Resources/app.asar.unpacked/client/dist';

test('packaged: serves the unpacked copy when it exists', () => {
  assert.equal(resolveClientDist(packed, (p) => p === unpacked), unpacked);
});

test('packaged without an unpacked copy: keeps the asar path', () => {
  assert.equal(resolveClientDist(packed, () => false), packed);
});

test('dev checkout: path is left alone', () => {
  const dev = '/Users/me/argus/client/dist';
  assert.equal(resolveClientDist(dev, () => true), dev);
});

test('only a whole app.asar path segment is rewritten', () => {
  const lookalike = '/tmp/my-app.asarish/client/dist';
  assert.equal(resolveClientDist(lookalike, () => true), lookalike);
});
