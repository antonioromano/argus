/**
 * Every URL the Help menu, the About sheet and Report an Issue open, in one
 * place (plan 002). Pure: no electron import, so tests and the menu share it.
 */

export const REPO_URL = 'https://github.com/antonioromano/argus';
export const ISSUES_NEW_URL = `${REPO_URL}/issues/new`;
export const RELEASES_URL = `${REPO_URL}/releases`;
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;
// TODO(plan 009): the docs site. The README is the documentation until then.
export const DOCS_URL = `${REPO_URL}#readme`;

/** GitHub rejects issue URLs somewhere past ~8 KB; stay well under. */
export const ISSUE_URL_MAX = 7000;

function issueBody(summary: string): string {
  return [
    '### What happened?',
    '',
    '',
    '### Steps to reproduce',
    '',
    '',
    '### Environment',
    '',
    summary,
    '',
    '### Diagnostics',
    '',
    'Argus copied the full diagnostics to your clipboard. Paste them below (Help → Copy Diagnostics copies them again). They hold counts only: no session names, paths or secrets.',
    '',
  ].join('\n');
}

/**
 * A prefilled "new issue" URL. Only the short environment summary goes in the
 * URL; the full diagnostics travel on the clipboard. The summary is cut first
 * if the encoded URL would still be too long.
 */
export function buildIssueUrl(summary: string, version: string): string {
  const build = (s: string) => `${ISSUES_NEW_URL}?${new URLSearchParams({
    title: `[${version}] `,
    labels: 'bug',
    body: issueBody(s),
  }).toString()}`;
  let s = summary;
  let url = build(s);
  while (url.length > ISSUE_URL_MAX && s.length > 0) {
    s = s.slice(0, Math.max(0, s.length - Math.max(64, url.length - ISSUE_URL_MAX)));
    url = build(s ? `${s}…` : '');
  }
  return url;
}
