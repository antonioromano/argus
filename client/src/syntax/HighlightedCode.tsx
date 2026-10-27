import { memo } from 'react';
import { resolveLang } from './highlighter.js';
import { useSyntaxTokens } from './useSyntax.js';

/**
 * A code block's text, highlighted with the shared highlighter. Renders the
 * plain string until the grammar has loaded (or when the language is unknown),
 * then swaps in `.argus-syn-*` spans painted from the --syn-* tokens. Put it
 * inside the caller's own `<pre><code>`.
 */
export const HighlightedCode = memo(function HighlightedCode({ code, language }: { code: string; language?: string | null }) {
  const tokens = useSyntaxTokens(code, resolveLang(language));
  if (!tokens) return <>{code}</>;
  return (
    <>
      {tokens.map((line, i) => (
        <span key={i}>
          {line.map((t, j) => (t.slot ? <span key={j} className={`argus-syn-${t.slot}`}>{t.text}</span> : t.text))}
          {i < tokens.length - 1 ? '\n' : null}
        </span>
      ))}
    </>
  );
});
