import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import type { Terminal } from '@xterm/xterm';
import type { SearchAddon, ISearchOptions } from '@xterm/addon-search';

interface TerminalSearchBarProps {
  searchAddonRef: React.RefObject<SearchAddon | null>;
  terminalRef: React.RefObject<Terminal | null>;
  onClose: () => void;
}

// Decoration colors (must be #RRGGBB). Tokens aren't usable here — xterm paints these directly.
const DECORATIONS = {
  matchBackground: '#3d59a1',
  matchOverviewRuler: '#3d59a1',
  activeMatchBackground: '#e0af68',
  activeMatchColorOverviewRuler: '#e0af68',
};

/** Browser-style find bar scoped to one terminal. Highlights matches, cycles next/prev. */
export function TerminalSearchBar({ searchAddonRef, terminalRef, onClose }: TerminalSearchBarProps) {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [results, setResults] = useState({ index: -1, count: 0 });
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Subscribe to result-count changes (only fires when decorations are enabled).
  useEffect(() => {
    const addon = searchAddonRef.current;
    if (!addon) return;
    const sub = addon.onDidChangeResults((r) => setResults({ index: r.resultIndex, count: r.resultCount }));
    return () => sub.dispose();
  }, [searchAddonRef]);

  // Focus the field when the bar opens.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Searches run from event handlers (input change, toggles, next/prev) — not from an
  // effect — so result/error state updates stay out of the render-effect cycle.
  const run = useCallback(
    (term: string, dir: 'next' | 'prev', cs: boolean, rx: boolean) => {
      const addon = searchAddonRef.current;
      if (!addon) return;
      if (!term) {
        addon.clearDecorations();
        setResults({ index: -1, count: 0 });
        setError(false);
        return;
      }
      const opts: ISearchOptions = { caseSensitive: cs, regex: rx, decorations: DECORATIONS };
      try {
        if (dir === 'next') addon.findNext(term, { ...opts, incremental: true });
        else addon.findPrevious(term, opts);
        setError(false);
      } catch {
        setError(true);
      }
    },
    [searchAddonRef],
  );

  const find = (dir: 'next' | 'prev') => run(query, dir, caseSensitive, regex);
  const onQueryChange = (value: string) => { setQuery(value); run(value, 'next', caseSensitive, regex); };
  const toggleCase = () => { const v = !caseSensitive; setCaseSensitive(v); run(query, 'next', v, regex); };
  const toggleRegex = () => { const v = !regex; setRegex(v); run(query, 'next', caseSensitive, v); };

  const close = useCallback(() => {
    searchAddonRef.current?.clearDecorations();
    onClose();
    terminalRef.current?.focus();
  }, [onClose, searchAddonRef, terminalRef]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      find(e.shiftKey ? 'prev' : 'next');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // don't let the global Escape handler exit focus view
      close();
    }
  };

  const countLabel = error
    ? 'Bad regex'
    : query && results.count === 0
      ? 'No results'
      : results.count > 0
        ? `${results.index + 1}/${results.count}`
        : '';

  const toggleBtn = (active: boolean): React.CSSProperties => ({
    height: 22,
    minWidth: 24,
    padding: '0 5px',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--line-3)'}`,
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? 'var(--bg-0)' : 'var(--fg-2)',
    borderRadius: 'var(--r-1)',
    fontSize: 11,
    fontFamily: 'var(--font-mono)',
    cursor: 'pointer',
    lineHeight: 1,
  });

  const iconBtn: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    padding: 0,
    border: '1px solid var(--line-3)',
    background: 'transparent',
    color: 'var(--fg-2)',
    borderRadius: 'var(--r-1)',
    cursor: 'pointer',
  };

  return (
    <div
      role="search"
      style={{
        position: 'absolute',
        top: 8,
        right: 10,
        zIndex: 5,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s-2)',
        padding: '5px 6px',
        background: 'var(--bg-2)',
        border: '1px solid var(--line-2)',
        borderRadius: 'var(--r-2)',
        boxShadow: 'var(--shadow-sheet)',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Find in terminal"
        spellCheck={false}
        autoComplete="off"
        style={{
          width: 180,
          height: 22,
          padding: '0 6px',
          border: `1px solid ${error ? 'var(--danger)' : 'var(--line-3)'}`,
          background: 'var(--bg-1)',
          color: 'var(--fg-0)',
          borderRadius: 'var(--r-1)',
          fontSize: 'var(--t-sm)',
          fontFamily: 'var(--font-sans)',
          outline: 'none',
        }}
      />
      <span style={{ minWidth: 44, textAlign: 'center', fontSize: 11, fontFamily: 'var(--font-mono)', color: error ? 'var(--danger)' : 'var(--fg-2)' }}>
        {countLabel}
      </span>
      <button type="button" title="Match case" aria-pressed={caseSensitive} onClick={toggleCase} style={toggleBtn(caseSensitive)}>Aa</button>
      <button type="button" title="Use regular expression" aria-pressed={regex} onClick={toggleRegex} style={toggleBtn(regex)}>.*</button>
      <button type="button" title="Previous match (Shift+Enter)" onClick={() => find('prev')} style={iconBtn}><ChevronUp size={14} /></button>
      <button type="button" title="Next match (Enter)" onClick={() => find('next')} style={iconBtn}><ChevronDown size={14} /></button>
      <button type="button" title="Close (Esc)" onClick={close} style={iconBtn}><X size={14} /></button>
    </div>
  );
}
