import { useEffect, useLayoutEffect, useMemo, useReducer, type RefObject } from 'react';
import { highlighterFor, loadLang, tokenizeSync, SYN_SLOTS, type SynSlot, type SynToken } from './highlighter.js';

/**
 * True once `lang`'s grammar is loaded; kicks off the load otherwise and
 * re-renders when it lands. Never blocks: callers render plain text meanwhile.
 */
export function useGrammarReady(lang: string | null): boolean {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const ready = !!lang && highlighterFor(lang) !== null;
  useEffect(() => {
    if (!lang || ready) return;
    let live = true;
    void loadLang(lang).then((ok) => {
      if (live && ok) bump();
    });
    return () => {
      live = false;
    };
  }, [lang, ready]);
  return ready;
}

/** Per-line tokens of `code`, or null while loading / for plain text. */
export function useSyntaxTokens(code: string, lang: string | null): SynToken[][] | null {
  const ready = useGrammarReady(lang);
  return useMemo(() => (ready && lang ? tokenizeSync(code, lang) : null), [ready, code, lang]);
}

// ── CSS Custom Highlight API ──────────────────────────────────────────────
// Diff rows keep their code as ONE text node: symbol nav hit-tests it
// (diffSymbolNav.hitTestWord) and inline edit types into it, so wrapping
// tokens in spans would break both. Instead each slot is a named highlight
// (`::highlight(argus-syn-kw)` in index.css) holding ranges over those nodes.

const HIGHLIGHT_PREFIX = 'argus-syn-';

function highlightsSupported(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
}

const registry = new Map<SynSlot, Highlight>();

function highlightFor(slot: SynSlot): Highlight {
  let h = registry.get(slot);
  if (!h) {
    h = new Highlight();
    registry.set(slot, h);
    CSS.highlights.set(HIGHLIGHT_PREFIX + slot, h);
  }
  return h;
}

/** The registered highlight names, for tests and the stylesheet. */
export const HIGHLIGHT_NAMES = SYN_SLOTS.map((s) => HIGHLIGHT_PREFIX + s);

/**
 * Paint `tokens` over the text node that is `ref`'s first child. Skips
 * silently if the node's text no longer matches (e.g. mid inline-edit) or the
 * API is missing (jsdom) — the row just stays plain.
 */
export function useSynRanges(ref: RefObject<HTMLElement | null>, tokens: SynToken[] | null | undefined): void {
  useLayoutEffect(() => {
    const node = ref.current?.firstChild;
    if (!tokens || !highlightsSupported() || !(node instanceof Text)) return;
    if (node.data !== tokens.map((t) => t.text).join('')) return;
    const added: [Highlight, Range][] = [];
    let offset = 0;
    for (const t of tokens) {
      const end = offset + t.text.length;
      if (t.slot && end > offset) {
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, end);
        const h = highlightFor(t.slot);
        h.add(range);
        added.push([h, range]);
      }
      offset = end;
    }
    return () => {
      for (const [h, range] of added) h.delete(range);
    };
  }, [ref, tokens]);
}
