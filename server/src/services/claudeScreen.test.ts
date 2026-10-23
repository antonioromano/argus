import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatInputBytes, inputStillPending, permissionModeFromFooter, promptInputText } from './claudeScreen.js';

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

test('finds the input box below echoed prompts', () => {
  const rows = ['❯ /model claude-sonnet-5-5', '  ⎿  Set model to Sonnet 5.5', '──────', '❯ /model claude-opus-5-5', '──────', '  ⏵⏵ auto mode on'];
  assert.equal(promptInputText(rows), '/model claude-opus-5-5');
  assert.equal(inputStillPending(rows, '/model claude-opus-5-5'), true);
  assert.equal(inputStillPending(['❯ /model claude-opus-5-5', '──', '❯ ', '──'], '/model claude-opus-5-5'), false, 'submitted: box is empty');
  assert.equal(inputStillPending(['❯ Try "fix lint errors"'], 'hello'), false, 'placeholder');
  assert.equal(inputStillPending(['❯ [Pasted text #1 +3 lines]'], 'a\nb\nc'), true);
  assert.equal(promptInputText(['no prompt here']), undefined);
});

test('chatInputBytes types one line as is and pastes multi-line text', () => {
  assert.equal(chatInputBytes('hello'), 'hello');
  assert.equal(chatInputBytes('a\r\nb\rc'), '\x1b[200~a\nb\nc\x1b[201~');
});
