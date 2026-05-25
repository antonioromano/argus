import type { CSSProperties } from 'react';

// Prism theme object using Argus CSS design tokens.
// CSS variable references resolve correctly in inline styles because the
// variables are defined on :root / [data-theme="dark"] on <html>.
const syntaxTheme: Record<string, CSSProperties> = {
  'code[class*="language-"]': {
    color: 'var(--color-text-primary)',
    background: 'transparent',
    fontFamily: 'var(--font-mono)',
    textAlign: 'left',
    whiteSpace: 'pre',
    wordSpacing: 'normal',
    wordBreak: 'normal',
    wordWrap: 'normal',
    lineHeight: 1.6,
    tabSize: 2,
    hyphens: 'none',
  },
  'pre[class*="language-"]': {
    color: 'var(--color-text-primary)',
    background: 'var(--color-bg-code)',
    fontFamily: 'var(--font-mono)',
    textAlign: 'left',
    whiteSpace: 'pre',
    wordSpacing: 'normal',
    wordBreak: 'normal',
    wordWrap: 'normal',
    lineHeight: 1.6,
    tabSize: 2,
    hyphens: 'none',
    margin: 0,
    padding: '16px',
    overflow: 'auto',
  },
  ':not(pre) > code[class*="language-"]': {
    background: 'var(--color-bg-code)',
    padding: '0.1em',
    borderRadius: '0.3em',
    whiteSpace: 'normal',
  },
  comment: {
    color: 'var(--color-text-muted)',
    fontStyle: 'italic',
  },
  prolog: {
    color: 'var(--color-text-muted)',
    fontStyle: 'italic',
  },
  doctype: {
    color: 'var(--color-text-muted)',
  },
  cdata: {
    color: 'var(--color-text-muted)',
    fontStyle: 'italic',
  },
  punctuation: {
    color: 'var(--color-text-muted)',
  },
  namespace: {
    opacity: 0.7,
  },
  property: {
    color: 'var(--color-text-secondary)',
  },
  tag: {
    color: 'var(--color-accent)',
  },
  boolean: {
    color: 'var(--color-accent)',
  },
  number: {
    color: 'var(--color-warning)',
  },
  constant: {
    color: 'var(--color-accent)',
  },
  symbol: {
    color: 'var(--color-accent)',
  },
  deleted: {
    color: 'var(--color-error)',
  },
  selector: {
    color: 'var(--color-accent)',
  },
  'attr-name': {
    color: 'var(--color-text-secondary)',
  },
  string: {
    color: 'var(--color-success)',
  },
  char: {
    color: 'var(--color-success)',
  },
  builtin: {
    color: 'var(--color-accent)',
  },
  inserted: {
    color: 'var(--color-success)',
  },
  operator: {
    color: 'var(--color-text-muted)',
  },
  entity: {
    color: 'var(--color-text-secondary)',
    cursor: 'help',
  },
  url: {
    color: 'var(--color-status-running)',
  },
  '.language-css .token.string': {
    color: 'var(--color-success)',
  },
  '.style .token.string': {
    color: 'var(--color-success)',
  },
  variable: {
    color: 'var(--color-text-secondary)',
  },
  atrule: {
    color: 'var(--color-accent)',
  },
  'attr-value': {
    color: 'var(--color-success)',
  },
  function: {
    color: 'var(--color-text-primary)',
    fontWeight: 600,
  },
  'class-name': {
    color: 'var(--color-accent)',
  },
  keyword: {
    color: 'var(--color-accent)',
  },
  regex: {
    color: 'var(--color-status-running)',
  },
  important: {
    color: 'var(--color-accent)',
    fontWeight: 'bold',
  },
  bold: {
    fontWeight: 'bold',
  },
  italic: {
    fontStyle: 'italic',
  },
};

export { syntaxTheme };
