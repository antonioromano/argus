import { useEffect, useRef, useState } from 'react';
import { FileText, FileCode, FileJson, GitCommit, FolderOpen, Search } from 'lucide-react';
import type { SessionInfo, FileSearchResult } from '@argus/shared';
import { api } from '../services/api.js';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: SessionInfo[];
  focusedSessionId: string | null;
  onOpenInExplorer: (filePath: string) => void;
  onOpenInDiff: (fileName: string) => void;
  theme: 'dark' | 'light';
}

function ResultIcon({ ext }: { ext: string }) {
  const style = { width: 14, height: 14, flexShrink: 0 as const, color: 'var(--color-text-muted)' };
  if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') return <FileCode style={style} />;
  if (ext === '.json') return <FileJson style={style} />;
  return <FileText style={style} />;
}

export function CommandPalette({
  isOpen,
  onClose,
  sessions,
  focusedSessionId,
  onOpenInExplorer,
  onOpenInDiff,
  theme: _theme,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FileSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const activeSession = sessions.find(s => s.id === focusedSessionId) ?? sessions[0] ?? null;

  // Reset state when palette opens
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  // Debounced search
  useEffect(() => {
    if (!query.trim() || !activeSession?.folderPath) {
      setResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const resp = await api.searchFiles(activeSession.folderPath, query.trim());
        // Sort: filename matches first, then content
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
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, activeSession]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const result = results[selectedIndex];
        if (result) {
          onOpenInExplorer(result.path);
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [isOpen, results, selectedIndex, onClose, onOpenInExplorer]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!isOpen) return null;

  const rootPath = activeSession?.folderPath ?? '';

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(12, 13, 24, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '10vh',
        zIndex: 10001,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--color-bg-header)',
          border: '1px solid var(--color-border-base)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-float)',
          width: '90vw',
          maxWidth: '560px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          maxHeight: '60vh',
        }}
      >
        {/* Search input row */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '12px 16px',
          borderBottom: results.length > 0 || isSearching ? '1px solid var(--color-border-base)' : 'none',
        }}>
          <Search size={15} strokeWidth={1.75} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={activeSession ? `Search in ${activeSession.name}…` : 'No session selected'}
            disabled={!activeSession}
            style={{
              flex: 1,
              background: 'none',
              border: 'none',
              outline: 'none',
              fontSize: '14px',
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-sans)',
            }}
          />
          <kbd style={{
            fontSize: '11px',
            color: 'var(--color-text-muted)',
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border-base)',
            borderRadius: '4px',
            padding: '2px 6px',
            fontFamily: 'var(--font-mono)',
            flexShrink: 0,
          }}>⌘K</kbd>
        </div>

        {/* Results */}
        {(results.length > 0 || isSearching) && (
          <div ref={listRef} style={{ overflowY: 'auto', flex: 1 }}>
            {isSearching && results.length === 0 ? (
              <div style={{ padding: '12px 16px 8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {[80, 60, 72, 50].map((w, i) => (
                  <div key={i} style={{ height: '32px', background: 'var(--color-bg-elevated)', borderRadius: 'var(--radius-sm)', width: `${w}%`, opacity: 0.5 }} />
                ))}
              </div>
            ) : (
              results.map((result, i) => {
                const isSelected = i === selectedIndex;
                const relativePath = result.path.startsWith(rootPath)
                  ? result.path.slice(rootPath.length + 1)
                  : result.path;
                const dir = relativePath.includes('/')
                  ? relativePath.slice(0, relativePath.lastIndexOf('/'))
                  : '';

                return (
                  <div
                    key={result.path}
                    onClick={() => { onOpenInExplorer(result.path); onClose(); }}
                    onMouseEnter={() => setSelectedIndex(i)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '8px 16px',
                      cursor: 'pointer',
                      background: isSelected ? 'var(--color-bg-elevated)' : 'transparent',
                      borderLeft: isSelected ? '2px solid var(--color-accent)' : '2px solid transparent',
                      userSelect: 'none',
                    }}
                  >
                    <ResultIcon ext={result.ext} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '13px',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: isSelected ? 600 : 500,
                        color: isSelected ? 'var(--color-accent)' : 'var(--color-text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {result.name}
                      </div>
                      {dir && (
                        <div style={{
                          fontSize: '11px',
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--color-text-muted)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {dir}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                      <span style={{
                        fontSize: '9px',
                        fontWeight: 600,
                        color: result.matchType === 'filename' ? 'var(--color-accent)' : 'var(--color-text-muted)',
                        background: result.matchType === 'filename' ? 'var(--color-accent-subtle)' : 'var(--color-bg-elevated)',
                        padding: '1px 5px',
                        borderRadius: 'var(--radius-sm)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}>
                        {result.matchType === 'filename' ? 'name' : 'content'}
                      </span>
                      <button
                        title="View in Diff"
                        onClick={e => {
                          e.stopPropagation();
                          onOpenInDiff(result.name);
                          onClose();
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '2px',
                          display: 'inline-flex',
                          borderRadius: 'var(--radius-sm)',
                          color: 'var(--color-text-muted)',
                          opacity: isSelected ? 1 : 0,
                          transition: 'opacity 0.1s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
                      >
                        <GitCommit size={12} strokeWidth={1.75} />
                      </button>
                      <button
                        title="Open in Explorer"
                        onClick={e => {
                          e.stopPropagation();
                          onOpenInExplorer(result.path);
                          onClose();
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '2px',
                          display: 'inline-flex',
                          borderRadius: 'var(--radius-sm)',
                          color: 'var(--color-text-muted)',
                          opacity: isSelected ? 1 : 0,
                          transition: 'opacity 0.1s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
                      >
                        <FolderOpen size={12} strokeWidth={1.75} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Empty state */}
        {!isSearching && query.trim() && results.length === 0 && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '32px 16px',
            gap: '8px',
            color: 'var(--color-text-muted)',
          }}>
            <Search size={24} strokeWidth={1} />
            <span style={{ fontSize: '13px' }}>No files found</span>
          </div>
        )}

        {/* Footer hint */}
        <div style={{
          display: 'flex',
          gap: '16px',
          padding: '8px 16px',
          borderTop: '1px solid var(--color-border-base)',
          flexShrink: 0,
        }}>
          {[
            { key: '↑↓', label: 'navigate' },
            { key: '↵', label: 'open in explorer' },
            { key: 'Esc', label: 'close' },
          ].map(({ key, label }) => (
            <span key={key} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--color-text-muted)' }}>
              <kbd style={{
                background: 'var(--color-bg-elevated)',
                border: '1px solid var(--color-border-base)',
                borderRadius: '3px',
                padding: '1px 5px',
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
              }}>{key}</kbd>
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
