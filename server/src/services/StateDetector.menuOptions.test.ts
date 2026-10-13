import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMenuOptions } from './StateDetector.js';

test('reads a Claude permission menu inside its box', () => {
  const rows = [
    '╭──────────────────────────────────────────────╮',
    '│ Bash command                                 │',
    '│   npm test                                   │',
    '│ Do you want to proceed?                      │',
    '│ ❯ 1. Yes                                     │',
    "│   2. Yes, and don't ask again for npm (tab)  │",
    '│   3. No, and tell Claude what to do (esc)    │',
    '╰──────────────────────────────────────────────╯',
  ];
  assert.deepEqual(parseMenuOptions(rows), [
    { key: '1', label: 'Yes' },
    { key: '2', label: "Yes, and don't ask again for npm (tab)" },
    { key: '3', label: 'No, and tell Claude what to do (esc)' },
  ]);
});

test('allows description rows between options and a cursor on any option', () => {
  const rows = [
    'Which approach?',
    '  1. Rewrite',
    '     Start from scratch',
    '› 2. Patch',
    '     Minimal change',
    'Enter to select · ↑/↓ to navigate',
  ];
  assert.deepEqual(parseMenuOptions(rows)?.map((o) => o.key), ['1', '2']);
});

test('a numbered list in prose (no cursor) is not a menu', () => {
  assert.equal(parseMenuOptions(['Plan:', '1. Read the code', '2. Fix it', '3. Test']), undefined);
});

test('rejects gaps, single options and out-of-order numbering', () => {
  assert.equal(parseMenuOptions(['❯ 1. Only']), undefined);
  assert.equal(parseMenuOptions(['❯ 1. A', '  3. C']), undefined);
  assert.equal(parseMenuOptions(['  2. B', '❯ 1. A']), undefined);
});

test('the last menu on screen wins over an earlier one', () => {
  const rows = ['❯ 1. Old', '  2. Older', 'some output', '❯ 1. New', '  2. Newer', '  3. Newest'];
  assert.deepEqual(parseMenuOptions(rows)?.map((o) => o.label), ['New', 'Newer', 'Newest']);
});

test('truncates very long labels', () => {
  const opts = parseMenuOptions([`❯ 1. ${'x'.repeat(200)}`, '  2. y'])!;
  assert.equal(opts[0]!.label.length, 80);
  assert.ok(opts[0]!.label.endsWith('…'));
});
