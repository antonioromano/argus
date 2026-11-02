import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changelogFromReleaseBody, RELEASE_FOOTER_MARKER } from './UpdateService.js';

// release.yml appends a first-launch footer for DMG downloaders; the in-app
// "What's new" must show the changes only.
test('the first-launch footer never reaches the update dialog', () => {
  const body = `- feat: one\n- fix: two\n\n${RELEASE_FOOTER_MARKER}\n---\n**First launch from the DMG:** Open Anyway…`;
  assert.equal(changelogFromReleaseBody(body), '- feat: one\n- fix: two');
});

test('a body without the footer is unchanged apart from comments', () => {
  assert.equal(changelogFromReleaseBody('- a\n<!-- note -->\n- b'), '- a\n\n- b');
});
