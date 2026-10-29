import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appOrigin, isTrustedSender, isSessionId, isRect, isFontPx,
  sanitizeShortcuts, isMenuCommandId, menuInvokeTarget,
} from './ipcGuards.js';

const ORIGIN = 'http://127.0.0.1:5757';
const mainFrame = { url: `${ORIGIN}/?windowId=main` };
const ev = (senderFrame: { url: string } | null, main: unknown = mainFrame) => ({ senderFrame, sender: { mainFrame: main } });

test('appOrigin mirrors window.ts', () => {
  assert.equal(appOrigin('5403'), 'http://127.0.0.1:5403');
  assert.equal(appOrigin(undefined), 'http://127.0.0.1:5757');
});

test('isTrustedSender: only our main frame on our origin', () => {
  assert.equal(isTrustedSender(ev(mainFrame), ORIGIN), true);
  // A subframe of our page.
  assert.equal(isTrustedSender(ev({ url: `${ORIGIN}/x` }), ORIGIN), false);
  // Main frame navigated elsewhere / other port / localhost alias / file:.
  for (const url of ['https://evil.example/', 'http://127.0.0.1:5758/', 'http://localhost:5757/', 'file:///etc/passwd', 'not a url']) {
    const f = { url };
    assert.equal(isTrustedSender(ev(f, f), ORIGIN), false, url);
  }
  assert.equal(isTrustedSender(ev(null), ORIGIN), false);
});

test('isSessionId / isRect / isFontPx shape guards', () => {
  assert.equal(isSessionId('3f2c1d9e-1b2a-4c3d-8e9f-0a1b2c3d4e5f'), true);
  for (const bad of ['', 'a/b', '../x', 'x'.repeat(129), 42, null, {}]) assert.equal(isSessionId(bad), false, String(bad));
  assert.equal(isRect({ x: 0, y: -4, width: 800, height: 600 }), true);
  for (const bad of [null, {}, { x: 0, y: 0, width: -1, height: 1 }, { x: NaN, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 1e9, height: 1 }, { x: '0', y: 0, width: 1, height: 1 }]) {
    assert.equal(isRect(bad), false, JSON.stringify(bad));
  }
  assert.equal(isFontPx(13), true);
  assert.equal(isFontPx(0), false);
  assert.equal(isFontPx(Infinity), false);
});

test('sanitizeShortcuts: small string map only', () => {
  assert.deepEqual(sanitizeShortcuts({ newSession: 'Cmd+N' }), { newSession: 'Cmd+N' });
  assert.equal(sanitizeShortcuts(null), null);
  assert.equal(sanitizeShortcuts(['Cmd+N']), null);
  assert.equal(sanitizeShortcuts({ a: 1 }), null);
  assert.equal(sanitizeShortcuts(Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`k${i}`, 'x']))), null);
});

test('isMenuCommandId: menu:-prefixed kebab ids only', () => {
  assert.equal(isMenuCommandId('menu:new-window'), true);
  assert.equal(isMenuCommandId('menu:toggle-theme'), true);
  for (const bad of ['menu:../x', 'menu:', 'menu:New', 'new-window', 'menu:x y', `menu:${'a'.repeat(80)}`, 42, null, undefined, {}]) {
    assert.equal(isMenuCommandId(bad), false, String(bad));
  }
});

test('menuInvokeTarget: trusted sender + main-run allowlist', () => {
  // A trusted main frame asking for a main-run command gets it.
  assert.equal(menuInvokeTarget(ev(mainFrame), 'menu:new-window', ORIGIN), 'menu:new-window');
  // An untrusted sender is refused even for an allowlisted id.
  assert.equal(menuInvokeTarget(ev({ url: `${ORIGIN}/x` }), 'menu:new-window', ORIGIN), null);
  const evil = { url: 'https://evil.example/' };
  assert.equal(menuInvokeTarget(ev(evil, evil), 'menu:quit-stop-all', ORIGIN), null);
  // Renderer-run, unknown and malformed ids are refused.
  assert.equal(menuInvokeTarget(ev(mainFrame), 'menu:open-settings', ORIGIN), null);
  assert.equal(menuInvokeTarget(ev(mainFrame), 'menu:nope', ORIGIN), null);
  assert.equal(menuInvokeTarget(ev(mainFrame), { id: 'menu:new-window' }, ORIGIN), null);
});
