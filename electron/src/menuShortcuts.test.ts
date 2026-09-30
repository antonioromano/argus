import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MENU_SHORTCUT_DEFAULTS,
  comboToAccelerator,
  getMenuShortcuts,
  menuAccelerator,
  setMenuShortcuts,
} from './menuShortcuts.js';

test.afterEach(() => { setMenuShortcuts({}); });

test('converts the registry default shapes', () => {
  assert.equal(comboToAccelerator('mod+d'), 'CmdOrCtrl+D');
  assert.equal(comboToAccelerator('mod+,'), 'CmdOrCtrl+,');
  assert.equal(comboToAccelerator('mod+shift+l'), 'CmdOrCtrl+Shift+L');
  assert.equal(comboToAccelerator('mod+alt+shift+f'), 'CmdOrCtrl+Alt+Shift+F');
});

test('every default converts to a valid accelerator', () => {
  for (const [id, combo] of Object.entries(MENU_SHORTCUT_DEFAULTS)) {
    assert.ok(comboToAccelerator(combo), `${id} (${combo}) must be expressible`);
  }
});

test('renames keys Electron names differently', () => {
  assert.equal(comboToAccelerator('mod+enter'), 'CmdOrCtrl+Return');
  assert.equal(comboToAccelerator('alt+arrowup'), 'Alt+Up');
  assert.equal(comboToAccelerator('mod+f12'), 'CmdOrCtrl+F12');
});

test('rejects a combo with no Cmd/Ctrl/Alt, so the menu never eats plain typing', () => {
  assert.equal(comboToAccelerator('t'), null);
  assert.equal(comboToAccelerator('shift+enter'), null);
});

test('rejects keys Electron has no accelerator name for', () => {
  assert.equal(comboToAccelerator('mod+f25'), null);
  assert.equal(comboToAccelerator('mod+dead'), null);
  assert.equal(comboToAccelerator(''), null);
  assert.equal(comboToAccelerator('mod+a+b'), null);
});

test('a rebound id reports changed and takes effect', () => {
  assert.equal(setMenuShortcuts({ 'open-diff': 'mod+shift+d' }), true);
  assert.equal(menuAccelerator('open-diff'), 'CmdOrCtrl+Shift+D');
});

test('re-applying the same bindings reports no change', () => {
  setMenuShortcuts({ 'open-diff': 'mod+shift+d' });
  assert.equal(setMenuShortcuts({ 'open-diff': 'mod+shift+d' }), false);
});

test('an id dropped from the payload reverts to its default', () => {
  setMenuShortcuts({ 'open-diff': 'mod+shift+d' });
  assert.equal(setMenuShortcuts({}), true);
  assert.equal(menuAccelerator('open-diff'), 'CmdOrCtrl+D');
});

test('an unusable binding falls back to the default without losing the item', () => {
  setMenuShortcuts({ 'open-shell': 'shift+enter' });
  assert.equal(menuAccelerator('open-shell'), 'CmdOrCtrl+T');
  assert.equal(getMenuShortcuts()['open-shell'], 'mod+t');
});

test('unknown ids are ignored', () => {
  assert.equal(setMenuShortcuts({ 'not-a-shortcut': 'mod+q' }), false);
});
