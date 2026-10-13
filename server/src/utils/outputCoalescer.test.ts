import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOutputCoalescer, COALESCE_MS } from './outputCoalescer.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('chunks inside one window are emitted as one message, in order', async () => {
  const out: string[] = [];
  const c = createOutputCoalescer((d) => out.push(d));
  c.push('a');
  c.push('b');
  c.push('c');
  assert.deepEqual(out, []);
  await wait(COALESCE_MS * 3);
  assert.deepEqual(out, ['abc']);
});

test('a burst over the byte cap flushes early', () => {
  const out: string[] = [];
  const c = createOutputCoalescer((d) => out.push(d), 1000, 4);
  c.push('ab');
  c.push('cd');
  assert.deepEqual(out, ['abcd']);
  c.dispose();
});

test('flush emits pending now; dispose makes later pushes immediate', async () => {
  const out: string[] = [];
  const c = createOutputCoalescer((d) => out.push(d));
  c.push('x');
  c.flush();
  assert.deepEqual(out, ['x']);
  c.flush();
  assert.deepEqual(out, ['x'], 'nothing pending → no empty emit');
  c.push('y');
  c.dispose();
  assert.deepEqual(out, ['x', 'y']);
  c.push('late');
  assert.deepEqual(out, ['x', 'y', 'late']);
  await wait(COALESCE_MS * 2);
  assert.deepEqual(out, ['x', 'y', 'late'], 'no stray timer emit');
});
