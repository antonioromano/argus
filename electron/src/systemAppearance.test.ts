import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAccent, composeAppearance, isWindowActive, type AppearanceInput } from './systemAppearance.js';

test('normalizeAccent turns macOS RRGGBBAA into #rrggbb', () => {
  assert.equal(normalizeAccent('0a84ffff'), '#0a84ff');
  assert.equal(normalizeAccent('0A84FF'), '#0a84ff');
  assert.equal(normalizeAccent('#0a84ffff'), '#0a84ff');
});

test('normalizeAccent rejects malformed input', () => {
  assert.equal(normalizeAccent('zz'), null);
  assert.equal(normalizeAccent(''), null);
  assert.equal(normalizeAccent('0a84f'), null);
  assert.equal(normalizeAccent('gggggggg'), null);
  assert.equal(normalizeAccent(undefined), null);
  assert.equal(normalizeAccent(42), null);
});

const clear: AppearanceInput = {
  accent: '#0a84ff', reduceTransparency: false, highContrast: false,
  fullscreen: false, windowActive: true, materialSetting: 'translucent',
};

test('composeAppearance: all clear is translucent, normal contrast, active', () => {
  assert.deepEqual(composeAppearance(clear), { accent: '#0a84ff', material: 'translucent', contrast: 'normal', active: true });
});

test('composeAppearance: each fallback forces a solid window', () => {
  assert.equal(composeAppearance({ ...clear, reduceTransparency: true }).material, 'solid');
  assert.equal(composeAppearance({ ...clear, fullscreen: true }).material, 'solid');
  assert.equal(composeAppearance({ ...clear, materialSetting: 'solid' }).material, 'solid');
  const hc = composeAppearance({ ...clear, highContrast: true });
  assert.equal(hc.material, 'solid');
  assert.equal(hc.contrast, 'more');
});

test('composeAppearance passes activity and accent through', () => {
  assert.equal(composeAppearance({ ...clear, windowActive: false }).active, false);
  assert.equal(composeAppearance({ ...clear, accent: null }).accent, null);
});

test('isWindowActive', () => {
  const a = { id: 'a' };
  const b = { id: 'b' };
  // App in the background: nothing is active.
  assert.equal(isWindowActive(false, a, a, []), false);
  // This window has OS focus.
  assert.equal(isWindowActive(true, a, a, []), true);
  // Another Argus window has OS focus.
  assert.equal(isWindowActive(true, b, a, []), false);
  // No BrowserWindow is focused, but this window owns the key native terminal
  // overlay: typing in a native tile must not grey out the UI.
  assert.equal(isWindowActive(true, null, a, [a]), true);
  assert.equal(isWindowActive(true, null, a, [null, b]), false);
  assert.equal(isWindowActive(true, null, a, []), false);
});
