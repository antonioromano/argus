import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workRootOf } from './workRoot.js';

test('agent sessions keep their folder; a Shell follows the repo it cd\'d into', () => {
  assert.equal(workRootOf({ folderPath: '/a' }), '/a');
  assert.equal(workRootOf({ folderPath: '/a', shellGit: null }), '/a', 'shell outside any repo');
  const git = { root: '/work/dashboard', branch: 'main', detached: false, ahead: 0, behind: 0, changes: 0 };
  assert.equal(workRootOf({ folderPath: '/a', shellGit: git }), '/work/dashboard');
});
