import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { zshIntegrationEnv, resolveAutosuggest } from './shellIntegration.js';

test('zsh: writes the startup files and returns the env that activates them', () => {
  const data = mkdtempSync(path.join(os.tmpdir(), 'argus-si-'));
  const env = zshIntegrationEnv(data, '/bin/zsh', { HOME: '/Users/me' })!;
  const dir = path.join(data, 'shell-integration', 'zsh');
  assert.equal(env.ZDOTDIR, dir);
  assert.equal(env.ARGUS_USER_ZDOTDIR, '/Users/me');
  for (const f of ['.zshenv', '.zprofile', '.zshrc', '.zlogin', 'integration.zsh']) {
    assert.ok(existsSync(path.join(dir, f)), `${f} written`);
  }
  // Each startup file forwards to the user's own before anything else.
  assert.match(readFileSync(path.join(dir, '.zprofile'), 'utf8'), /source \$ZDOTDIR\/\.zprofile/);
  assert.match(readFileSync(path.join(dir, '.zshrc'), 'utf8'), /source \$ZDOTDIR\/\.zshrc/);
});

test('a user ZDOTDIR wins over HOME', () => {
  const data = mkdtempSync(path.join(os.tmpdir(), 'argus-si-'));
  const env = zshIntegrationEnv(data, '/bin/zsh', { HOME: '/Users/me', ZDOTDIR: '/Users/me/.config/zsh' })!;
  assert.equal(env.ARGUS_USER_ZDOTDIR, '/Users/me/.config/zsh');
});

test('non-zsh shells get no integration', () => {
  const data = mkdtempSync(path.join(os.tmpdir(), 'argus-si-'));
  assert.equal(zshIntegrationEnv(data, '/bin/bash', { HOME: '/Users/me' }), null);
  assert.equal(zshIntegrationEnv(data, '/opt/homebrew/bin/fish', { HOME: '/Users/me' }), null);
});

test('the bundled zsh-autosuggestions resolves in the repo', () => {
  assert.ok(existsSync(resolveAutosuggest()), resolveAutosuggest());
});
