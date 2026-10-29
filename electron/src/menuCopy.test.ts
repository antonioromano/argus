import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MENU_COMMANDS, MENU_LAYOUT, menuCommandLabel, setMenuAppearance, describeMenuCommands } from './menuModel.js';

// macOS HIG menu copy (plan 008, Unit 6): an ellipsis on items that need more
// input before they act, no "Toggle …" labels, title case.

test.afterEach(() => { setMenuAppearance(true); });

// Words the HIG keeps lowercase inside a title (never as the first word).
const SMALL = new Set(['a', 'an', 'and', 'the', 'for', 'in', 'on', 'of', 'to', 'at', 'by', 'or', '&']);

// Items that open an input, a sheet or a find bar.
const NEEDS_INPUT = [
  'menu:open-settings', 'menu:new-session', 'menu:review-launch',
  'menu:toggle-palette', 'menu:session-search', 'menu:terminal-search', 'menu:whats-new',
  // Opens a prefilled GitHub issue form for the user to complete.
  'menu:report-issue',
  // Open a save / open dialog.
  'menu:export-settings', 'menu:import-settings',
];

const placed = new Set<string>(MENU_LAYOUT.flatMap((m) => m.items.flatMap((i) => (typeof i === 'string' ? [i] : []))));
const labels = () => MENU_COMMANDS.filter((c) => placed.has(c.id)).map((c) => [c.id, menuCommandLabel(c)] as const);

test('no menu label starts with "Toggle"', () => {
  for (const [id, label] of labels()) assert.doesNotMatch(label, /^Toggle\b/, `${id}: ${label}`);
});

test('labels are title case (HIG small words excepted)', () => {
  for (const [id, label] of labels()) {
    label.replace(/…$/, '').split(/\s+/).forEach((word, i) => {
      if (i > 0 && SMALL.has(word)) return;
      assert.match(word, /^[A-Z0-9&]/, `${id}: "${word}" in "${label}"`);
    });
  }
});

test('items that need more input end with a real ellipsis (U+2026); nothing uses three dots', () => {
  for (const [id, label] of labels()) {
    assert.doesNotMatch(label, /\.\.\./, `${id}: ${label}`);
    const wants = NEEDS_INPUT.includes(id);
    assert.equal(label.endsWith('…'), wants, `${id}: ${label}`);
  }
});

test('the appearance item names the switch it will make', () => {
  const theme = MENU_COMMANDS.find((c) => c.id === 'menu:toggle-theme')!;
  setMenuAppearance(true);
  assert.equal(menuCommandLabel(theme), 'Use Light Appearance');
  assert.equal(setMenuAppearance(false), true);
  assert.equal(menuCommandLabel(theme), 'Use Dark Appearance');
  assert.equal(describeMenuCommands().find((w) => w.id === 'menu:toggle-theme')!.label, 'Use Dark Appearance');
  assert.equal(setMenuAppearance(false), false, 'no change, no rebuild');
});
