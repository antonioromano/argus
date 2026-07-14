import { useEffect, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { api } from '../../../services/api.js';

// cmd/ctrl+click go-to-definition for the custom (non-Monaco) diff renderer.
// The diff shows plain text spans, so there are no Monaco models to lean on.
// Instead we hit-test the click coordinate to the word under the cursor, then
// reuse the same server-backed resolution the editor uses (api.findDefinition /
// api.resolveImport). Mirrors registerSymbolProviders.ts (import-first, then
// word → first ranked location).

const WORD_CHAR = /[A-Za-z0-9_$]/;

/** The modifier that turns a diff click into a navigation (⌘ on mac, Ctrl elsewhere). */
export function isNavModifier(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.metaKey || e.ctrlKey;
}

/**
 * Expand the identifier surrounding `offset` in `text`. Returns null when the
 * caret sits between two non-word characters (blank space, punctuation) so a
 * click on empty gutter/whitespace does not resolve a bogus symbol.
 */
export function wordAt(
  text: string,
  offset: number,
): { word: string; start: number; end: number } | null {
  if (offset < 0 || offset > text.length) return null;
  const rightIsWord = offset < text.length && WORD_CHAR.test(text[offset]);
  const leftIsWord = offset > 0 && WORD_CHAR.test(text[offset - 1]);
  if (!rightIsWord && !leftIsWord) return null;
  let start = offset;
  let end = offset;
  while (start > 0 && WORD_CHAR.test(text[start - 1])) start--;
  while (end < text.length && WORD_CHAR.test(text[end])) end++;
  if (start === end) return null;
  return { word: text.slice(start, end), start, end };
}

/**
 * If `offset` falls inside a quoted specifier on an import/require/from line,
 * return the specifier (e.g. `./foo`), else null. Line-based port of
 * registerSymbolProviders' importSpecifierAt (no Monaco model here).
 */
export function importSpecifierAt(line: string, offset: number): string | null {
  if (!/\b(?:from|import|require)\b/.test(line)) return null;
  const re = /(['"])(.*?)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const start = m.index + 1;
    const end = start + m[2].length;
    if (offset >= start && offset <= end) return m[2];
  }
  return null;
}

export interface DiffClickHit {
  word: string;
  /** Character offset within the containing text node. */
  offset: number;
  /** Full text of the clicked line (used for import-specifier detection). */
  lineText: string;
}

/**
 * DOM seam: map a viewport point to the word under it. Uses the Chromium
 * `caretRangeFromPoint` (Electron) with a `caretPositionFromPoint` fallback.
 * Isolated here because jsdom implements neither — pure logic is tested
 * separately.
 */
export function hitTestWord(clientX: number, clientY: number): DiffClickHit | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
  };
  let node: Node | null = null;
  let offset = 0;
  if (typeof doc.caretRangeFromPoint === 'function') {
    const range = doc.caretRangeFromPoint(clientX, clientY);
    if (!range) return null;
    node = range.startContainer;
    offset = range.startOffset;
  } else if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(clientX, clientY);
    if (!pos) return null;
    node = pos.offsetNode;
    offset = pos.offset;
  } else {
    return null;
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const lineText = node.textContent ?? '';
  const w = wordAt(lineText, offset);
  if (!w) return null;
  return { word: w.word, offset, lineText };
}

export interface DiffNavRequest {
  /** Absolute path of the file whose diff line was clicked. */
  filePath: string;
  /** Word under the cursor, or null when a specifier is being resolved. */
  word: string | null;
  /** 1-based line the click landed on; only used server-side to drop the self-hit. */
  line: number;
  /** Import specifier under the cursor, or null. */
  specifier: string | null;
}

/**
 * Resolve a diff click to a definition and hand the target to `open`. Silent on
 * failure / no result, matching the editor's cmd+click behavior.
 */
export async function resolveDefinition(
  req: DiffNavRequest,
  open: (path: string, line?: number) => void,
): Promise<void> {
  try {
    if (req.specifier) {
      const { path } = await api.resolveImport(req.filePath, req.specifier);
      if (path) open(path, 1);
      return;
    }
    if (!req.word) return;
    const res = await api.findDefinition(req.filePath, req.word, req.line);
    const loc = res.locations[0];
    if (loc) open(loc.path, loc.line);
  } catch {
    // no definition, offline, or unsupported language — stay silent.
  }
}

/**
 * onClick handler shared by the unified and split diff renderers. Only acts when
 * the nav modifier is held; hit-tests the word, prefers an import specifier, and
 * routes through resolveDefinition. Callers should also preventDefault on
 * mousedown (see components) so a modifier-click never places an edit caret.
 */
export function onDiffCodeClick(
  e: ReactMouseEvent,
  filePath: string,
  line: number,
  open: (path: string, line?: number) => void,
): void {
  if (!isNavModifier(e)) return;
  e.preventDefault();
  e.stopPropagation();
  const hit = hitTestWord(e.clientX, e.clientY);
  if (!hit) return;
  const specifier = importSpecifierAt(hit.lineText, hit.offset);
  void resolveDefinition(
    { filePath, word: specifier ? null : hit.word, line, specifier },
    open,
  );
}

/** Symbol-nav context threaded into the diff renderers for cmd+click go-to-def. */
export interface DiffNav {
  /** Absolute path of the file being diffed. */
  filePath: string;
  /** Whether the nav modifier is currently held (drives the link cursor). */
  held: boolean;
  /** Open the resolved definition target in the editor. */
  open: (path: string, line?: number) => void;
}

/**
 * Build the onMouseDown/onClick handlers and cursor for one diff code cell.
 * Returns empty handlers when nav is disabled so callers can spread
 * unconditionally.
 */
export function diffNavHandlers(
  nav: DiffNav | null | undefined,
  line: number | undefined,
): {
  handlers: { onMouseDown?: (e: ReactMouseEvent) => void; onClick?: (e: ReactMouseEvent) => void };
  cursor: 'pointer' | undefined;
} {
  if (!nav) return { handlers: {}, cursor: undefined };
  return {
    handlers: {
      onMouseDown: (e: ReactMouseEvent) => {
        if (isNavModifier(e)) e.preventDefault();
      },
      onClick: (e: ReactMouseEvent) => onDiffCodeClick(e, nav.filePath, line ?? 0, nav.open),
    },
    cursor: nav.held ? 'pointer' : undefined,
  };
}

/**
 * Tracks whether the nav modifier (⌘/Ctrl) is currently held, so the diff can
 * show a link cursor over clickable code. Clears on blur to avoid a stuck state
 * when focus leaves the window mid-hold.
 */
export function useNavModifierHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const update = (e: KeyboardEvent) => setHeld(e.metaKey || e.ctrlKey);
    const clear = () => setHeld(false);
    window.addEventListener('keydown', update);
    window.addEventListener('keyup', update);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', update);
      window.removeEventListener('keyup', update);
      window.removeEventListener('blur', clear);
    };
  }, []);
  return held;
}
