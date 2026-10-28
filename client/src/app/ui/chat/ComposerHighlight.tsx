import { forwardRef, memo, useEffect, useMemo, useState } from 'react';
import { resolveLang } from '../../../syntax/highlighter.js';
import { useSyntaxTokens } from '../../../syntax/useSyntax.js';
import { composerLines, type Line, type Span } from './composerMarkdown.js';

// Each source line is one block, so line breaks match the textarea's; an
// empty line needs a character to keep its height.
const EMPTY = '\u200b';
/** Over this the layer shows the text plain: parsing it on every keystroke would lag typing. */
export const MAX_STYLED_CHARS = 20_000;
/** Code is re-highlighted once typing pauses this long; edited lines show plain meanwhile. */
export const CODE_HIGHLIGHT_DELAY_MS = 150;

/** `value`, updated once it has stopped changing for `ms`. */
function useSettled(value: string, ms: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

function spanClass(s: Span): string | undefined {
  const c: string[] = [];
  if (s.mark) c.push('is-mark');
  if (s.bold) c.push('is-bold');
  if (s.italic) c.push('is-italic');
  if (s.code) c.push('is-code');
  if (s.open) c.push('is-open');
  if (s.close) c.push('is-close');
  if (s.bullet) c.push('is-bullet');
  if (s.number) c.push('is-number');
  return c.length ? c.join(' ') : undefined;
}

/** The lines of one fenced block, highlighted with the shared highlighter once its grammar is in. */
function CodeLines({ lines, lang }: { lines: string[]; lang: string | null }) {
  // Tokenize the settled text, not every keystroke; rows still match it line by line below.
  const code = useSettled(lines.join('\n'), CODE_HIGHLIGHT_DELAY_MS);
  const tokens = useSyntaxTokens(code, resolveLang(lang));
  return (
    <>
      {lines.map((line, i) => {
        const row = tokens?.[i];
        // Tokens that don't spell the line exactly would misalign the layer: show it plain.
        const ok = row && row.map((t) => t.text).join('') === line;
        return (
          <div key={i} className="argus-cmp-line is-code">
            {!line ? EMPTY : ok ? row.map((t, j) => (t.slot ? <span key={j} className={`argus-syn-${t.slot}`}>{t.text}</span> : t.text)) : line}
          </div>
        );
      })}
    </>
  );
}

/**
 * The styled copy of the composer text drawn under its transparent textarea
 * (D2). Every character is the textarea's own, in the same font, so wrapping
 * and the caret line up; styles never change a glyph's width (bold is drawn
 * with a text shadow, code with a background, list markers over themselves).
 */
export const ComposerHighlight = memo(
  forwardRef<HTMLDivElement, { text: string }>(function ComposerHighlight({ text }, ref) {
    const lines = useMemo(
      () => (text.length > MAX_STYLED_CHARS ? text.split('\n').map((t): Line => ({ kind: 'text', spans: t ? [{ text: t }] : [] })) : composerLines(text)),
      [text],
    );
    return (
      <div className="argus-cmp-layer" aria-hidden>
        <div ref={ref} className="argus-cmp-content" data-testid="composer-highlight">
          {lines.map((l, i) => {
            if (l.kind === 'code') return null;
            if (l.kind === 'fence') {
              // An opening fence: one box for it, its code and its closing fence (when typed).
              const code = lines[i + 1];
              if (code?.kind !== 'code') return null;
              const close = lines[i + 2];
              return (
                <div key={i} className="argus-cmp-codebox" data-testid="composer-codebox">
                  <div className="argus-cmp-line is-fence">{l.text || EMPTY}</div>
                  <CodeLines lines={code.lines} lang={code.lang} />
                  {close?.kind === 'fence' && <div className="argus-cmp-line is-fence">{close.text || EMPTY}</div>}
                </div>
              );
            }
            const cls = `argus-cmp-line${l.heading ? ' is-heading' : ''}${l.quote ? ' is-quote' : ''}`;
            return (
              <div key={i} className={cls}>
                {l.spans.length === 0
                  ? EMPTY
                  : l.spans.map((s, j) => {
                      const c = spanClass(s);
                      return c ? <span key={j} className={c}>{s.text}</span> : s.text;
                    })}
              </div>
            );
          })}
        </div>
      </div>
    );
  }),
);
