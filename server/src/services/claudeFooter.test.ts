import { test } from 'node:test';
import assert from 'node:assert/strict';
import { permissionModeFromFooter } from './claudeFooter.js';

test('reads every mode Claude Code paints in its footer', () => {
  // Captured from Claude Code 2.1.309, cycling with Shift+Tab.
  const cases: Array<[string, string]> = [
    ['  ⏵⏵ auto mode on (shift+tab to cycle) · PR #51 · ← for agents', 'auto'],
    ['  ⏸ manual mode on · PR #51', 'default'],
    ['  ⏵⏵ accept edits on (shift+tab to cycle) · PR #51', 'acceptEdits'],
    ['  ⏸ plan mode on (shift+tab to cycle) · PR #51', 'plan'],
    ['  ⏵⏵ bypass permissions on (shift+tab to cycle)', 'bypassPermissions'],
  ];
  for (const [line, mode] of cases) {
    assert.equal(permissionModeFromFooter(['  Opus 5.5·1M medium', line]), mode, line);
  }
});

test('ignores mentions outside the footer and screens without one', () => {
  assert.equal(permissionModeFromFooter(['> turn plan mode on please', '❯ Try "fix lint errors"']), undefined);
  assert.equal(permissionModeFromFooter([]), undefined);
  assert.equal(permissionModeFromFooter(['  ? for shortcuts']), undefined);
});

test('the lowest footer line wins', () => {
  assert.equal(permissionModeFromFooter(['  ⏸ plan mode on', '  ⏵⏵ auto mode on']), 'auto');
});
