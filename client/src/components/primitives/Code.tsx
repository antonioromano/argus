import type { ReactNode } from 'react';

interface CodeLineProps {
  n: number | string;
  dim?: boolean;
  children?: ReactNode;
}

export function CodeLine({ n, dim, children }: CodeLineProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'baseline',
      gap: 'var(--s-3)',
      fontSize: 'var(--t-xs)',
    }}>
      <span className="mono" style={{ color: 'var(--fg-4)', width: 28, textAlign: 'right', flexShrink: 0 }}>
        {n}
      </span>
      <span className="mono" style={{ color: dim ? 'var(--fg-3)' : 'var(--fg-1)' }}>
        {children}
      </span>
    </div>
  );
}

export type TokKind = 'kw' | 'str' | 'num' | 'fn' | 'cm' | 'pn';

const TOK_COLOR: Record<TokKind, string> = {
  kw: 'var(--syn-kw)',
  str: 'var(--syn-str)',
  num: 'var(--syn-num)',
  fn: 'var(--syn-fn)',
  cm: 'var(--syn-cm)',
  pn: 'var(--syn-pn)',
};

export function Tok({ kind, children }: { kind: TokKind; children: ReactNode }) {
  return <span style={{ color: TOK_COLOR[kind] }}>{children}</span>;
}
