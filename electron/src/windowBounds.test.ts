import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debounce, isOnDisplay, resolveInitialBounds, DEFAULT_WIDTH, DEFAULT_HEIGHT } from './windowBounds.js';

const primary = { id: 1, workArea: { x: 0, y: 25, width: 1440, height: 875 } };
const external = { id: 2, workArea: { x: 1440, y: 0, width: 2560, height: 1415 } };

test('a window fully on its display keeps its position and size', () => {
  const r = resolveInitialBounds({ displayId: 1, bounds: { x: 100, y: 60, width: 1200, height: 800 } }, [primary], primary);
  assert.deepEqual(r, { x: 100, y: 60, width: 1200, height: 800 });
});

test('saved y below the work area is dropped, so the window is centred', () => {
  const r = resolveInitialBounds({ displayId: 1, bounds: { x: 100, y: 2000, width: 1200, height: 800 } }, [primary], primary);
  assert.equal(r.x, undefined);
  assert.equal(r.y, undefined);
});

test('a title bar above the work area (under the menu bar) is pulled back', () => {
  assert.equal(isOnDisplay({ x: 100, y: 0, width: 900, height: 700 }, primary.workArea), false);
});

test('a disconnected display falls back to the primary and is clamped to it', () => {
  const r = resolveInitialBounds({ displayId: 2, bounds: { x: 1600, y: 40, width: 2400, height: 1300 } }, [primary], primary);
  assert.equal(r.width, 1440);
  assert.equal(r.height, 875);
  assert.equal(r.x, undefined, 'the old external-display x is off the primary');
});

test('a connected secondary display is used when it is still there', () => {
  const r = resolveInitialBounds({ displayId: 2, bounds: { x: 1600, y: 40, width: 2000, height: 1200 } }, [primary, external], primary);
  assert.deepEqual(r, { x: 1600, y: 40, width: 2000, height: 1200 });
});

test('a window mostly off the left edge stays put while 64px of title bar shows', () => {
  assert.equal(isOnDisplay({ x: -836, y: 60, width: 900, height: 700 }, primary.workArea), true);
  assert.equal(isOnDisplay({ x: -850, y: 60, width: 900, height: 700 }, primary.workArea), false);
});

test('no saved state opens at the default size, centred', () => {
  assert.deepEqual(resolveInitialBounds(undefined, [primary], primary), { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
});

test('the size never drops below the window minimum', () => {
  const r = resolveInitialBounds({ displayId: 1, bounds: { x: 0, y: 30, width: 300, height: 200 } }, [primary], primary);
  assert.equal(r.width, 800);
  assert.equal(r.height, 600);
});

test('debounce runs once after a burst, and flush runs a pending call now', async () => {
  let n = 0;
  const d = debounce(() => { n += 1; }, 20);
  d(); d(); d();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(n, 1);
  d();
  d.flush();
  assert.equal(n, 2);
  d.flush();
  assert.equal(n, 2, 'nothing pending, nothing run');
});
