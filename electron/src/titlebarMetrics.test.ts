import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trafficLights, DEFAULT_TITLEBAR_H, clampTitlebarHeight } from './titlebarMetrics.js';

test('traffic lights are vertically centred on the default 44px toolbar', () => {
  assert.deepEqual(trafficLights(44), { x: 16, y: 15, inset: 82 });
  assert.equal(DEFAULT_TITLEBAR_H, 44);
});

test('a taller toolbar moves the buttons down; the left inset does not change', () => {
  assert.ok(trafficLights(38).y < trafficLights(44).y);
  assert.ok(trafficLights(44).y < trafficLights(52).y);
  assert.equal(trafficLights(38).y, 12);
  assert.equal(trafficLights(52).y, 19);
  assert.equal(trafficLights(38).inset, trafficLights(52).inset);
});

test('clampTitlebarHeight accepts sane heights only', () => {
  assert.equal(clampTitlebarHeight(38), 38);
  assert.equal(clampTitlebarHeight(52.4), 52);
  assert.equal(clampTitlebarHeight(10), null);
  assert.equal(clampTitlebarHeight(500), null);
  assert.equal(clampTitlebarHeight('44'), null);
  assert.equal(clampTitlebarHeight(Number.NaN), null);
});
