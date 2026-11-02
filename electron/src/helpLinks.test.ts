import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOCS_URL, ISSUES_NEW_URL, ISSUE_URL_MAX, LICENSE_URL, RELEASES_URL, REPO_URL, buildIssueUrl } from './helpLinks.js';

// The same gate main.ts's openExternalAllowlisted applies.
const ALLOWED = /^(https?:\/\/|mailto:)/;

test('every link passes the openExternal allowlist', () => {
  for (const url of [REPO_URL, ISSUES_NEW_URL, RELEASES_URL, LICENSE_URL, DOCS_URL, buildIssueUrl('x', '1.0.0')]) {
    assert.match(url, ALLOWED, url);
  }
});

test('the issue URL is prefilled with title, label and the summary', () => {
  const url = new URL(buildIssueUrl('- Argus 1.2.3\n- Sessions: 2 #1 & more', '1.2.3'));
  assert.equal(`${url.origin}${url.pathname}`, ISSUES_NEW_URL);
  assert.equal(url.searchParams.get('title'), '[1.2.3] ');
  assert.equal(url.searchParams.get('labels'), 'bug');
  const body = url.searchParams.get('body')!;
  assert.ok(body.includes('- Sessions: 2 #1 & more'), body);
  assert.ok(body.includes('Paste them below'));
});

test('a huge summary is cut so the URL stays under the limit', () => {
  const url = buildIssueUrl('é#& line\n'.repeat(600), '1.0.0');
  assert.ok(url.length <= ISSUE_URL_MAX, String(url.length));
  assert.ok(new URL(url).searchParams.get('body')!.includes('### Diagnostics'));
});
