import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';

/**
 * Engine-agnostic backing for the search box: xterm.js (its SearchAddon,
 * decorations and all) and the native SwiftTerm overlay (an async IPC round
 * trip, no decorations) both implement this so the ONE search UI can drive
 * either. See TerminalShell.tsx for both adapters.
 */
export interface TerminalSearchEngine {
  /** Run a search. May resolve/reject asynchronously (native); a synchronous
   *  throw (xterm, bad regex) is also a valid failure signal. */
  find(term: string, direction: 'next' | 'prev', options: { caseSensitive: boolean; regex: boolean }): Promise<void> | undefined;
  /** Clear any highlighting/selection for the current search. */
  clear(): void;
  /** Subscribe to result-count changes; returns an unsubscribe function. */
  onResults(cb: (r: { index: number; count: number }) => void): () => void;
  /** Return keyboard focus to the terminal itself (called on close). */
  focusTerminal(): void;
}

interface TerminalSearchBarProps {
  engine: TerminalSearchEngine;
  onClose: () => void;
}

/**
 * Browser-style find bar scoped to one terminal. Highlights matches, cycles
 * next/prev. Only ever used by the xterm.js path now (a native tile drives
 * SwiftTerm's own find bar instead — see TerminalShellNativeHole in
 * TerminalShell.tsx). Forwards its root element as a general affordance for
 * a caller that needs to measure or position relative to this box; no
 * current caller uses it (it did, briefly, for a native-overlay-suppression
 * measurement that this task's reversal removed).
 */
export const TerminalSearchBar = forwardRef<HTMLDivElement, TerminalSearchBarProps>(function TerminalSearchBar({ engine, onClose }, ref) {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [results, setResults] = useState({ index: -1, count: 0 });
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Subscribe to result-count changes (xterm: only fires when decorations are
  // enabled; native: fires once per completed search — see the adapter).
  useEffect(() => {
    return engine.onResults((r) => setResults(r));
  }, [engine]);

  // Focus the field when the bar opens.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Searches run from event handlers (input change, toggles, next/prev) — not from an
  // effect — so result/error state updates stay out of the render-effect cycle.
  const run = useCallback(
    (term: string, dir: 'next' | 'prev', cs: boolean, rx: boolean) => {
      if (!term) {
        engine.clear();
        setResults({ index: -1, count: 0 });
        setError(false);
        return;
      }
      try {
        const outcome = engine.find(term, dir, { caseSensitive: cs, regex: rx });
        if (outcome) {
          outcome.then(() => setError(false), () => setError(true));
        } else {
          setError(false);
        }
      } catch {
        setError(true);
      }
    },
    [engine],
  );

  const find = (dir: 'next' | 'prev') => run(query, dir, caseSensitive, regex);
  const onQueryChange = (value: string) => { setQuery(value); run(value, 'next', caseSensitive, regex); };
  const toggleCase = () => { const v = !caseSensitive; setCaseSensitive(v); run(query, 'next', v, regex); };
  const toggleRegex = () => { const v = !regex; setRegex(v); run(query, 'next', caseSensitive, v); };

  const close = useCallback(() => {
    engine.clear();
    onClose();
    engine.focusTerminal();
  }, [onClose, engine]);

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
      ref={ref}
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
});
