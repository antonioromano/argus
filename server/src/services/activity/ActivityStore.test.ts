import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVITY_RING_CAP, ActivityStore } from './ActivityStore.js';

test('keeps the last 500 entries per session, oldest dropped first', () => {
  const store = new ActivityStore();
  for (let i = 0; i < ACTIVITY_RING_CAP + 25; i++) store.append('a', { type: 'tool', tool: 'Bash', summary: `#${i}` });
  const list = store.list('a');
  assert.equal(ACTIVITY_RING_CAP, 500);
  assert.equal(list.length, 500);
  assert.equal(list[0]!.summary, '#25');
  assert.equal(list.at(-1)!.summary, `#${ACTIVITY_RING_CAP + 24}`);
});

test('rings are per session; ids increase; timestamps come from the clock', () => {
  let t = 1000;
  const store = new ActivityStore(3, () => t++);
  const a = store.append('a', { type: 'stop', summary: '' });
  const b = store.append('b', { type: 'stop', summary: '' });
  assert.ok(b.id > a.id);
  assert.equal(a.at, 1000);
  assert.equal(store.list('a').length, 1);
  assert.equal(store.list('b').length, 1);
  assert.deepEqual(store.list('none'), []);
});

test('drop removes one session; clear removes all; list returns a copy', () => {
  const store = new ActivityStore();
  store.append('a', { type: 'stop', summary: '' });
  store.append('b', { type: 'stop', summary: '' });
  store.list('a').length = 0;
  assert.equal(store.list('a').length, 1);
  store.drop('a');
  assert.deepEqual(store.list('a'), []);
  assert.equal(store.list('b').length, 1);
  store.clear();
  assert.deepEqual(store.list('b'), []);
});
