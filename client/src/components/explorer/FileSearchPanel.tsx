import { useEffect, useRef, useState } from 'react';
import type { FileSearchResult } from '@argus/shared';
import { Search, FileText, FileCode, FileJson, X } from 'lucide-react';
import { isMac } from '../../utils/platform.js';
import { api } from '../../services/api.js';

interface FileSearchPanelProps {
  folderPath: string;
  initialQuery?: string;
  onSelectFile: (path: string, lineNumber?: number) => void;
  onClose: () => void;
}

function ResultIcon({ ext }: { ext: string }) {
  const style: React.CSSProperties = { width: 13, height: 13, flexShrink: 0, color: 'var(--fg-3)' };
  if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) return <FileCode style={style} />;
  if (ext === '.json') return <FileJson style={style} />;
  return <FileText style={style} />;
}

export function FileSearchPanel({ folderPath, initialQuery, onSelectFile, onClose }: FileSearchPanelProps) {
  const [query, setQuery] = useState(initialQuery ?? '');
  const [results, setResults] = useState<FileSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-focus on mount.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  // Clear results when the query is emptied (adjust-during-render); the effect
  // below only runs the debounced search for a non-empty query.
  const queryActive = !!query.trim();
  const [searchActive, setSearchActive] = useState(false);
  if (searchActive !== queryActive) {
    setSearchActive(queryActive);
    if (!queryActive) {
      setResults([]);
      setSearching(false);
    }
  }

  // Debounced search.
  useEffect(() => {
    if (!query.trim()) return;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const resp = await api.searchFiles(folderPath, query.trim());
        const sorted = [...resp.results].sort((a, b) => {
          if (a.matchType === 'filename' && b.matchType !== 'filename') return -1;
          if (b.matchType === 'filename' && a.matchType !== 'filename') return 1;
          return 0;
        });
        setResults(sorted);
        setSelectedIndex(0);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query, folderPath]);

  // Scroll selected item into view.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Keyboard navigation — capture phase so Escape doesn't bubble to Overlay and close the explorer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter' && results.length > 0) {
        e.preventDefault();
        const r = results[selectedIndex];
        if (r) { onSelectFile(r.path, r.lineNumber); onClose(); }
        return;
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [results, selectedIndex, onSelectFile, onClose]);

  const relPath = (abs: string) => abs.startsWith(folderPath)
    ? abs.slice(folderPath.length).replace(/^\//, '')
    : abs;

  const shortcut = isMac ? '⌘K' : 'Ctrl+K';

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 'var(--z-sticky)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-1)',
        animation: 'argus-fade-in var(--dur-base) var(--ease-out)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          borderBottom: '1px solid var(--line-2)',
          flexShrink: 0,
        }}
      >
        <Search size={13} strokeWidth={1.6} color="var(--fg-3)" style={{ flexShrink: 0 }} />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search files…"
          aria-label="Search files"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-autocomplete="list"
          aria-controls={results.length > 0 ? 'file-search-listbox' : undefined}
          aria-activedescendant={results.length > 0 ? `file-search-opt-${selectedIndex}` : undefined}
          style={{
            flex: 1,
            background: 'none',
            border: 'none',
            outline: 'none',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-sm)',
            color: 'var(--fg-0)',
          }}
        />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-tiny)',
            color: 'var(--fg-3)',
            flexShrink: 0,
          }}
        >
          {shortcut}
        </span>
        <button
          onClick={onClose}
          aria-label="Close search"
          style={{
            all: 'unset',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            color: 'var(--fg-3)',
            flexShrink: 0,
          }}
        >
          <X size={13} strokeWidth={1.6} />
        </button>
      </div>

      {/* Results */}
      <div
        ref={listRef}
        id="file-search-listbox"
        role="listbox"
        aria-label="File search results"
        style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}
      >
        {!query.trim() && (
          <div style={emptyStyle}>Type to search files</div>
        )}
        {query.trim() && !searching && results.length === 0 && (
          <div style={emptyStyle}>No results</div>
        )}
        {results.map((r, i) => {
          const selected = i === selectedIndex;
          return (
            <div
              key={r.path + (r.lineNumber ?? '')}
              id={`file-search-opt-${i}`}
              data-idx={i}
              role="option"
              aria-selected={selected}
              onClick={() => { onSelectFile(r.path, r.lineNumber); onClose(); }}
              onMouseEnter={() => setSelectedIndex(i)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 10px',
                cursor: 'pointer',
                background: selected ? 'var(--bg-3)' : 'transparent',
                borderLeft: selected ? '2px solid var(--accent)' : '2px solid transparent',
                minWidth: 0,
              }}
            >
              <ResultIcon ext={r.ext} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--t-sm)',
                    color: 'var(--fg-0)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.name}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--t-tiny)',
                    color: 'var(--fg-3)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {relPath(r.path)}{r.lineNumber ? `:${r.lineNumber}` : ''}
                </div>
              </div>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--t-tiny)',
                  color: r.matchType === 'filename' ? 'var(--accent)' : 'var(--fg-4)',
                  flexShrink: 0,
                  letterSpacing: 'var(--tracking-eye)',
                }}
              >
                {r.matchType === 'filename' ? 'NAME' : 'CONTENT'}
              </span>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          padding: '4px 10px',
          borderTop: '1px solid var(--line-2)',
          flexShrink: 0,
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--t-tiny)',
          color: 'var(--fg-3)',
        }}
      >
        <span>↑↓ navigate</span>
        <span>↵ open</span>
        <span>Esc close</span>
      </div>
    </div>
  );
}

const emptyStyle: React.CSSProperties = {
  padding: '20px 10px',
  textAlign: 'center',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--t-sm)',
  color: 'var(--fg-3)',
};
