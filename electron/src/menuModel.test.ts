import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MENU_COMMANDS, MENU_LAYOUT, MAIN_COMMAND_IDS, RENDERER_COMMAND_IDS,
  isMainCommandId, menuCommandAccelerator, describeMenuCommands, toWire,
} from './menuModel.js';
import { MENU_SHORTCUT_DEFAULTS, setMenuShortcuts } from './menuShortcuts.js';
import { COLLIDING_MENU_CHANNELS } from './menuAcceleratorGating.js';

test.afterEach(() => { setMenuShortcuts({}); });

const layoutIds = (): string[] =>
  MENU_LAYOUT.flatMap((m) => m.items.flatMap((i) => (typeof i === 'string' && i !== 'separator' ? [i as string] : [])));

test('every command id is menu:-prefixed and unique', () => {
  const ids = MENU_COMMANDS.map((c) => c.id);
  for (const id of ids) assert.match(id, /^menu:[a-z-]+$/, id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every command appears exactly once in the layout, and the layout names no unknown id', () => {
  const placed = layoutIds();
  for (const c of MENU_COMMANDS) {
    assert.equal(placed.filter((id) => id === c.id).length, 1, `${c.id} must be placed exactly once`);
  }
  const known = new Set<string>(MENU_COMMANDS.map((c) => c.id));
  for (const id of placed) assert.ok(known.has(id), `layout names unknown id ${id}`);
});

test('a command sits in the layout menu of its own section', () => {
  for (const menu of MENU_LAYOUT) {
    for (const item of menu.items) {
      if (typeof item !== 'string' || item === 'separator') continue;
      const def = MENU_COMMANDS.find((c) => c.id === item)!;
      assert.equal(def.section, menu.section, `${item} is under ${menu.section}`);
    }
  }
});

test('main/renderer id lists partition the commands', () => {
  for (const c of MENU_COMMANDS) {
    const inMain = (MAIN_COMMAND_IDS as readonly string[]).includes(c.id);
    const inRenderer = (RENDERER_COMMAND_IDS as readonly string[]).includes(c.id);
    assert.equal(inMain, c.runIn === 'main', c.id);
    assert.equal(inRenderer, c.runIn === 'renderer', c.id);
  }
});

test('isMainCommandId accepts only main-run ids', () => {
  assert.equal(isMainCommandId('menu:new-window'), true);
  assert.equal(isMainCommandId('menu:quit-stop-all'), true);
  // A renderer command must never run through menu:invoke.
  assert.equal(isMainCommandId('menu:open-settings'), false);
  assert.equal(isMainCommandId('menu:nope'), false);
  assert.equal(isMainCommandId(42), false);
  assert.equal(isMainCommandId(undefined), false);
  assert.equal(isMainCommandId('toString'), false);
});

test('every shortcut field names a menu shortcut, and no command has both kinds of accelerator', () => {
  for (const c of MENU_COMMANDS) {
    if (c.shortcut) {
      assert.ok(c.shortcut in MENU_SHORTCUT_DEFAULTS, `${c.id}.shortcut ${c.shortcut}`);
      assert.equal(c.accelerator, undefined, `${c.id} has both shortcut and accelerator`);
    }
  }
});

test('the Monaco-colliding channels are all real menu commands', () => {
  const ids = new Set<string>(MENU_COMMANDS.map((c) => c.id));
  for (const ch of COLLIDING_MENU_CHANNELS) assert.ok(ids.has(ch), ch);
});

test('the three items that used to be dead are renderer commands', () => {
  for (const id of ['menu:open-settings', 'menu:toggle-palette', 'menu:toggle-theme']) {
    assert.ok((RENDERER_COMMAND_IDS as readonly string[]).includes(id), id);
  }
});

test('Toggle Theme follows the toggle-theme binding (⌘⇧L by default)', () => {
  const def = MENU_COMMANDS.find((c) => c.id === 'menu:toggle-theme')!;
  assert.equal(def.shortcut, 'toggle-theme');
  assert.equal(menuCommandAccelerator(def), 'CmdOrCtrl+Shift+L');
});

test('a rebind resolves through menuAccelerator', () => {
  const def = MENU_COMMANDS.find((c) => c.id === 'menu:open-diff')!;
  assert.equal(menuCommandAccelerator(def), 'CmdOrCtrl+D');
  setMenuShortcuts({ 'open-diff': 'mod+shift+d' });
  assert.equal(menuCommandAccelerator(def), 'CmdOrCtrl+Shift+D');
});

test('fixed accelerators and none', () => {
  const quit = MENU_COMMANDS.find((c) => c.id === 'menu:quit-stop-all')!;
  assert.equal(menuCommandAccelerator(quit), 'CmdOrCtrl+Shift+Q');
  const merge = MENU_COMMANDS.find((c) => c.id === 'menu:merge-windows')!;
  assert.equal(menuCommandAccelerator(merge), null);
});

test('describeMenuCommands returns one wire descriptor per command with live accelerators', () => {
  setMenuShortcuts({ 'toggle-theme': 'mod+alt+t' });
  const wire = describeMenuCommands();
  assert.equal(wire.length, MENU_COMMANDS.length);
  const theme = wire.find((w) => w.id === 'menu:toggle-theme')!;
  assert.deepEqual(theme, {
    id: 'menu:toggle-theme', label: 'Toggle Theme', section: 'View',
    accelerator: 'CmdOrCtrl+Alt+T', runIn: 'renderer', palette: true,
  });
});

test('toWire marks a paletteExclude command as palette: false', () => {
  const w = toWire({ id: 'menu:x', label: 'X', section: 'View', runIn: 'renderer', paletteExclude: 'why' }, null);
  assert.equal(w.palette, false);
});

// The client imports these modules from its tests (and, later, the palette).
// An `electron` import would break the client build in a confusing way.
test('menuModel.ts and menuShortcuts.ts never import electron', () => {
  const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  for (const f of ['menuModel.ts', 'menuShortcuts.ts']) {
    const text = readFileSync(join(srcDir, f), 'utf8');
    assert.doesNotMatch(text, /from\s+['"]electron['"]/, f);
    assert.doesNotMatch(text, /require\(\s*['"]electron['"]\s*\)/, f);
  }
});
