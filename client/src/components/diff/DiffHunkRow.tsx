import type { ReactNode } from 'react';
import type { DiffLine, DiffToken } from '@argus/shared';

interface DiffHunkRowProps {
  line: DiffLine;
  searchQuery?: string;
  wordWrap?: boolean;
}

function highlightText(text: string, query: string): ReactNode {
  const lower = text.toLowerCase();
  const queryLower = query.toLowerCase();
  const parts: ReactNode[] = [];
  let last = 0;
  let idx = lower.indexOf(queryLower, last);
  while (idx !== -1) {
    if (idx > last) parts.push(text.slice(last, idx));
    parts.push(
      <mark
        key={idx}
        style={{
          background: 'rgba(255,213,79,0.55)',
          color: 'inherit',
          borderRadius: '2px',
          padding: '0 1px',
        }}
      >
        {text.slice(idx, idx + query.length)}
      </mark>
    );
    last = idx + query.length;
    idx = lower.indexOf(queryLower, last);
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function renderToken(token: DiffToken, index: number, searchQuery?: string): ReactNode {
  const color =
    token.type === 'del'
      ? 'var(--color-diff-del-text)'
      : token.type === 'add'
      ? 'var(--color-diff-add-text)'
      : undefined;

  const content = searchQuery ? highlightText(token.text, searchQuery) : token.text;

  return (
    <span key={index} style={{ color }}>
      {content}
    </span>
  );
}

export function DiffHunkRow({ line, searchQuery, wordWrap }: DiffHunkRowProps) {
  const bg =
    line.type === 'del'
      ? 'var(--color-diff-del-bg)'
      : line.type === 'add'
      ? 'var(--color-diff-add-bg)'
      : line.type === 'spacer'
      ? 'var(--color-diff-hunk-bg, rgba(128,128,128,0.05))'
      : 'transparent';

  // Spacer rows represent "no corresponding line" in side-by-side mode
  if (line.type === 'spacer') {
    return (
      <div
        style={{
          height: '20px',
          lineHeight: '20px',
          background: bg,
          borderLeft: '2px solid transparent',
        }}
      />
    );
  }

  const borderLeft =
    line.type === 'del'
      ? '2px solid var(--color-diff-del-border)'
      : line.type === 'add'
      ? '2px solid var(--color-diff-add-border)'
      : 'none';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        background: bg,
        lineHeight: '20px',
        height: '20px',
        fontSize: '12px',
        fontFamily: 'var(--font-mono)',
        borderLeft,
      }}
    >
      <span
        style={{
          flex: 1,
          minWidth: 0,
          padding: '0 8px',
          whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
          wordBreak: wordWrap ? 'break-all' : undefined,
          overflow: wordWrap ? undefined : 'hidden',
        }}
      >
        {line.tokens.map((token, i) => renderToken(token, i, searchQuery))}
      </span>
    </div>
  );
}
