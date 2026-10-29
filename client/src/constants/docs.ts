/**
 * The user docs site (plan 009): Markdown under `site/`, published by GitHub
 * Pages. Duplicated in electron/src/helpLinks.ts (main cannot import renderer
 * code) and pinned by check:deps; check:docs-links fails when a `docsUrl()`
 * path here or there has no page under `site/`.
 */
export const DOCS_URL = 'https://antonioromano.github.io/argus';

/** A page of the docs site: `docsUrl('/beta/handoff/')`. */
export function docsUrl(path = '/'): string {
  return `${DOCS_URL}${path.startsWith('/') ? path : `/${path}`}`;
}
