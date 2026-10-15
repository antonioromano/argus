import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeRendererEnv } from './claudeRenderer.js';

test('fullscreen turns on the alt-screen renderer for claude', () => {
  assert.deepEqual(claudeRendererEnv('claude', 'fullscreen'), { CLAUDE_CODE_NO_FLICKER: '1' });
});

test('classic forces the main-screen renderer, overriding a user tui:fullscreen', () => {
  assert.deepEqual(claudeRendererEnv('claude', 'classic'), { CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: '1' });
});

test('inherit adds nothing, so the user\'s own Claude setting applies', () => {
  assert.deepEqual(claudeRendererEnv('claude', 'inherit'), {});
});

test('an unset renderer means the shipped default, fullscreen', () => {
  assert.deepEqual(claudeRendererEnv('claude', undefined), { CLAUDE_CODE_NO_FLICKER: '1' });
});

test('a custom agent that runs claude by path or with args gets it too', () => {
  assert.deepEqual(claudeRendererEnv('/opt/homebrew/bin/claude', 'fullscreen'), { CLAUDE_CODE_NO_FLICKER: '1' });
  assert.deepEqual(claudeRendererEnv('claude --model opus', 'classic'), { CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: '1' });
});

test('other agents and shells are untouched', () => {
  for (const command of ['gemini', 'codex', '/bin/zsh', 'claude-wrapper', 'my-claude']) {
    assert.deepEqual(claudeRendererEnv(command, 'fullscreen'), {}, command);
    assert.deepEqual(claudeRendererEnv(command, 'classic'), {}, command);
  }
});
