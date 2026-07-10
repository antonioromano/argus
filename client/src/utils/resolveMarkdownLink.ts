/**
 * Classify + resolve a markdown link href against the file it appears in.
 *
 * Used by MarkdownPreview to route link clicks:
 *  - external  → open in the system browser (openExternal)
 *  - anchor    → scroll the preview pane to a heading id
 *  - internal  → open the target file in the workbench (symbolNavContext.onOpen)
 *
 * Paths are absolute, matching the file-tree path scheme (rooted at the
 * session folder). Relative hrefs resolve against the current file's directory;
 * a leading "/" resolves against the session root.
 */
export type MarkdownLink =
  | { kind: 'external'; href: string }
  | { kind: 'anchor'; id: string }
  | { kind: 'internal'; path: string };

const EXTERNAL_SCHEME = /^[a-z][a-z0-9+.-]*:/i; // http:, https:, mailto:, vscode:, etc.

/** Normalize a "/"-joined path, collapsing "." and ".." (clamped at root). */
function normalizePath(input: string): string {
  const leadingSlash = input.startsWith('/');
  const out: string[] = [];
  for (const seg of input.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      out.pop(); // clamp: over-popping past root is a no-op
      continue;
    }
    out.push(seg);
  }
  return (leadingSlash ? '/' : '') + out.join('/');
}

function parentDir(filePath: string): string {
  const i = filePath.lastIndexOf('/');
  return i <= 0 ? '/' : filePath.slice(0, i);
}

export function resolveMarkdownLink(href: string, filePath: string, rootPath: string): MarkdownLink {
  const raw = href.trim();

  // In-page anchor (e.g. "#section").
  if (raw.startsWith('#')) {
    return { kind: 'anchor', id: decodeURIComponent(raw.slice(1)) };
  }

  // Anything with a URI scheme (http/https/mailto/…) is external.
  if (EXTERNAL_SCHEME.test(raw) || raw.startsWith('//')) {
    return { kind: 'external', href: raw };
  }

  // Strip any trailing #anchor / ?query before resolving the path portion.
  const pathPart = raw.split(/[#?]/)[0];

  const base = pathPart.startsWith('/') ? rootPath + pathPart : parentDir(filePath) + '/' + pathPart;
  return { kind: 'internal', path: normalizePath(base) };
}

export interface MarkdownLinkHandlers {
  /** External URL → hand off to the system browser. */
  openExternal: (href: string) => void;
  /** In-repo file → open in the workbench. */
  openInternal: (path: string) => void;
  /** In-page heading → scroll the preview pane. */
  scrollToAnchor: (id: string) => void;
}

/** Route a resolved markdown link to the correct side effect. Pure branching,
 *  unit-tested independently of the React component. */
export function dispatchMarkdownLink(link: MarkdownLink, handlers: MarkdownLinkHandlers): void {
  if (link.kind === 'external') handlers.openExternal(link.href);
  else if (link.kind === 'anchor') handlers.scrollToAnchor(link.id);
  else handlers.openInternal(link.path);
}
