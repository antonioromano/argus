import { forwardRef, memo, useMemo } from 'react';
import { resolveLang } from '../../../syntax/highlighter.js';
import { useSyntaxTokens } from '../../../syntax/useSyntax.js';
import { composerLines, type Span } from './composerMarkdown.js';

// Each source line is one block, so line breaks match the textarea's; an
// empty line needs a character to keep its height.
const EMPTY = '\u200b';

function spanClass(s: Span): string | undefined {
  const c: string[] = [];
  if (s.mark) c.push('is-mark');
  if (s.bold) c.push('is-bold');
  if (s.italic) c.push('is-italic');
  if (s.code) c.push('is-code');
  if (s.bullet) c.push('is-bullet');
  if (s.number) c.push('is-number');
  return c.length ? c.join(' ') : undefined;
}

/** The lines of one fenced block, highlighted with the shared highlighter once its grammar is in. */
function CodeLines({ lines, lang }: { lines: string[]; lang: string | null }) {
  const code = lines.join('\n');
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
    const lines = useMemo(() => composerLines(text), [text]);
    return (
      <div className="argus-cmp-layer" aria-hidden>
        <div ref={ref} className="argus-cmp-content" data-testid="composer-highlight">
          {lines.map((l, i) => {
            if (l.kind === 'code') return <CodeLines key={i} lines={l.lines} lang={l.lang} />;
            if (l.kind === 'fence') return <div key={i} className="argus-cmp-line is-fence">{l.text || EMPTY}</div>;
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
