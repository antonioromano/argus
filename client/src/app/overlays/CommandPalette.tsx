import { useEffect, useRef, useState } from 'react';
import type { SessionInfo, FileSearchResult } from '@argus/shared';
import { Search, FileText, FileCode, FileJson, GitCommit, FolderOpen } from 'lucide-react';
import { isMac, isPrimaryModifier } from '../../utils/platform.js';
import { api } from '../../services/api.js';
import { Kbd, Tooltip } from '../../components/primitives/index.js';

const SHORTCUT = isMac ? '⌘K' : 'Ctrl+K';

interface CommandPaletteProps {
  sessions: SessionInfo[];
  /** Session the palette is scoped to on open (focused session), or null to open unscoped. */
  initialScopeSessionId: string | null;
  onClose: () => void;
  onJumpSession: (id: string) => void;
  onOpenInExplorer: (sessionId: string, filePath: string, lineNumber?: number, query?: string) => void;
  onOpenInDiff: (sessionId: string, fileName: string) => void;
}

function ResultIcon({ ext }: { ext: string }) {
  const style: React.CSSProperties = { width: 14, height: 14, flexShrink: 0, color: 'var(--fg-3)' };
  if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) return <FileCode style={style} />;
  if (ext === '.json') return <FileJson style={style} />;
  return <FileText style={style} />;
}

export function CommandPalette({
  sessions,
  initialScopeSessionId,
  onClose,
  onJumpSession,
  onOpenInExplorer,
  onOpenInDiff,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [scopedSessionId, setScopedSessionId] = useState<string | null>(initialScopeSessionId);
  const [results, setResults] = useState<FileSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listboxId = 'cmd-palette-listbox';
  const optionId = (i: number) => `cmd-palette-opt-${i}`;

  // Explicit scope — no sessions[0] fallback. Unscoped = session-pick stage.
  const scopedSession = sessions.find((s) => s.id === scopedSessionId) ?? null;

  // Scoped session vanished (deleted while open) — drop back to session-pick
  // stage. Adjust-during-render.
  if (scopedSessionId && !scopedSession) {
    setScopedSessionId(null);
  }

  const scopeTo = (id: string) => {
    setScopedSessionId(id);
    setQuery('');
    setSelectedIndex(0);
    inputRef.current?.focus();
  };

  // Build session-jump items prefixed when query is short or starts with '>'
  const sessionItems = sessions
    .filter((s) =>
      !query.trim() ||
      s.name.toLowerCase().includes(query.toLowerCase()) ||
      s.folderPath.toLowerCase().includes(query.toLowerCase()),
    )
    .slice(0, 5);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  // Clear results when the query is emptied (adjust-during-render); the effect
  // below only runs the debounced search for an active query.
  const queryActive = !!query.trim() && !!scopedSession;
  const [searchActive, setSearchActive] = useState(false);
  if (searchActive !== queryActive) {
    setSearchActive(queryActive);
    if (!queryActive) {
      setResults([]);
      setSearching(false);
    }
  }

  useEffect(() => {
    if (!query.trim() || !scopedSession) return;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const resp = await api.searchFiles(scopedSession.folderPath, query.trim());
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
  }, [query, scopedSession]);

  const total = sessionItems.length + results.length;

  // Keep selection in range as the list grows/shrinks (e.g. session-only
  // filtering changes sessionItems.length). Adjust-during-render.
  if (selectedIndex > Math.max(0, total - 1)) {
    setSelectedIndex(Math.max(0, total - 1));
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      // Backspace on an empty query clears the scope (back to session-pick).
      if (e.key === 'Backspace' && query === '' && scopedSession) {
        e.preventDefault();
        setScopedSessionId(null);
        setSelectedIndex(0);
        return;
      }
      if (total === 0) return; // nothing to navigate/select — avoid index -1
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, total - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedIndex < sessionItems.length) {
          const id = sessionItems[selectedIndex].id;
          // ⌘Enter jumps to focus view; plain Enter scopes the palette.
          if (isPrimaryModifier(e)) {
            onJumpSession(id);
          } else {
            scopeTo(id);
          }
        } else {
          const r = results[selectedIndex - sessionItems.length];
          if (r && scopedSession) {
            onOpenInExplorer(scopedSession.id, r.path, r.lineNumber, query);
          }
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [selectedIndex, total, sessionItems, results, query, scopedSession, onClose, onJumpSession, onOpenInExplorer]);

  useEffect(() => {
    const item = document.getElementById(optionId(selectedIndex));
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Clear the preview when no file row is selected (adjust-during-render); the
  // effect below only fetches a preview for a selected file row.
  const previewFileSelected =
    selectedIndex - sessionItems.length >= 0 &&
    selectedIndex - sessionItems.length < results.length;
  const [previewActive, setPreviewActive] = useState(false);
  if (previewActive !== previewFileSelected) {
    setPreviewActive(previewFileSelected);
    if (!previewFileSelected) {
      setPreviewContent(null);
      setPreviewLoading(false);
    }
  }

  useEffect(() => {
    const fileIdx = selectedIndex - sessionItems.length;
    if (fileIdx < 0 || fileIdx >= results.length) return;
    const r = results[fileIdx];
    const t = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const resp = await api.getFileContent(r.path);
        setPreviewContent(resp.content);
      } catch {
        setPreviewContent(null);
      } finally {
        setPreviewLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(t);
    };
  }, [selectedIndex, sessionItems.length, results]);

  const rootPath = scopedSession?.folderPath ?? '';
  const selectedFileResult = selectedIndex >= sessionItems.length
    ? (results[selectedIndex - sessionItems.length] ?? null)
    : null;

  return (
    <div
      style={{
        background: 'var(--bg-2)',
        border: '1px solid var(--line-3)',
        borderRadius: 'var(--r-3)',
        boxShadow: 'var(--shadow-pop)',
        width: 'min(90vw, 560px)',
        maxHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: 'var(--s-3) var(--s-4)',
          borderBottom: total > 0 || searching ? '1px solid var(--line-2)' : 'none',
        }}
      >
        <Search size={14} strokeWidth={1.6} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        {scopedSession && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              flexShrink: 0,
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-tiny)',
              color: 'var(--accent)',
              background: 'var(--accent-bg)',
              border: '1px solid var(--accent-edge)',
              borderRadius: 'var(--r-1)',
              padding: '2px 7px',
              whiteSpace: 'nowrap',
            }}
          >
            <FolderOpen size={11} strokeWidth={1.6} />
            {scopedSession.name}
            <button
              aria-label="Clear scope"
              onClick={() => { setScopedSessionId(null); setSelectedIndex(0); inputRef.current?.focus(); }}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                marginLeft: 2,
                color: 'var(--accent)',
                opacity: 0.55,
                fontSize: 11,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </span>
        )}
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={total > 0}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={total > 0 ? optionId(selectedIndex) : undefined}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={scopedSession ? `Search in ${scopedSession.name}…` : 'Jump to a session…'}
          style={{
            flex: 1,
            background: 'none',
            border: 'none',
            outline: 'none',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-md)',
            color: 'var(--fg-0)',
          }}
        />
        <Kbd>{SHORTCUT}</Kbd>
      </div>

      {(total > 0 || searching) && (
        <div ref={listRef} id={listboxId} role="listbox" className="argus-scroll" style={{ overflowY: 'auto', flex: 1 }}>
          {sessionItems.length > 0 && (
            <div>
              <div className="eyebrow" style={{ padding: 'var(--s-2) var(--s-4)', color: 'var(--fg-3)' }}>SESSIONS</div>
              {sessionItems.map((s, i) => {
                const isSelected = selectedIndex === i;
                return (
                  <div
                    key={s.id}
                    id={optionId(i)}
                    role="option"
                    aria-selected={isSelected}
                    onClick={(e) => (e.metaKey || e.ctrlKey ? onJumpSession(s.id) : scopeTo(s.id))}
                    onMouseEnter={() => setSelectedIndex(i)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px var(--s-4)',
                      cursor: 'pointer',
                      background: isSelected ? 'var(--bg-3)' : 'transparent',
                      borderLeft: `2px solid ${isSelected ? 'var(--accent)' : 'transparent'}`,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--t-sm)',
                        fontWeight: 500,
                        color: isSelected ? 'var(--accent)' : 'var(--fg-0)',
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {s.name}
                    </span>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--t-micro)',
                        color: 'var(--fg-3)',
                      }}
                    >
                      {s.folderPath.split('/').slice(-2).join('/')}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {results.length > 0 && (
            <div>
              <div className="eyebrow" style={{ padding: 'var(--s-2) var(--s-4)', color: 'var(--fg-3)' }}>FILES</div>
              {results.map((r, idx) => {
                const i = idx + sessionItems.length;
                const isSelected = selectedIndex === i;
                const rel = r.path.startsWith(rootPath) ? r.path.slice(rootPath.length + 1) : r.path;
                const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
                return (
                  <div
                    key={r.path}
                    id={optionId(i)}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => { if (scopedSession) { onOpenInExplorer(scopedSession.id, r.path, r.lineNumber, query); } }}
                    onMouseEnter={() => setSelectedIndex(i)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px var(--s-4)',
                      cursor: 'pointer',
                      background: isSelected ? 'var(--bg-3)' : 'transparent',
                      borderLeft: `2px solid ${isSelected ? 'var(--accent)' : 'transparent'}`,
                    }}
                  >
                    <ResultIcon ext={r.ext} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--t-sm)',
                          color: isSelected ? 'var(--accent)' : 'var(--fg-0)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {r.name}
                      </div>
                      {dir && (
                        <div className="eyebrow" style={{ color: 'var(--fg-3)' }}>
                          {dir}
                        </div>
                      )}
                    </div>
                    <span
                      className="eyebrow"
                      style={{
                        color: r.matchType === 'filename' ? 'var(--accent)' : 'var(--fg-3)',
                        background: r.matchType === 'filename' ? 'var(--accent-bg)' : 'var(--bg-1)',
                        border: `1px solid ${r.matchType === 'filename' ? 'var(--accent-edge)' : 'var(--line-2)'}`,
                        padding: '1px 5px',
                        borderRadius: 'var(--r-1)',
                      }}
                    >
                      {r.matchType}
                    </span>
                    <Tooltip content="View in Diff">
                      <button
                        onClick={(e) => { e.stopPropagation(); if (scopedSession) { onOpenInDiff(scopedSession.id, r.name); } }}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 2,
                          color: isSelected ? 'var(--accent)' : 'var(--fg-3)',
                          opacity: isSelected ? 1 : 0,
                          transition: 'opacity var(--dur-fast)',
                        }}
                      >
                        <GitCommit size={12} strokeWidth={1.6} />
                      </button>
                    </Tooltip>
                    <Tooltip content="Open in Explorer">
                    <button
                      onClick={(e) => { e.stopPropagation(); if (scopedSession) { onOpenInExplorer(scopedSession.id, r.path, r.lineNumber, query); } }}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 2,
                        color: isSelected ? 'var(--accent)' : 'var(--fg-3)',
                        opacity: isSelected ? 1 : 0,
                        transition: 'opacity var(--dur-fast)',
                      }}
                    >
                      <FolderOpen size={12} strokeWidth={1.6} />
                    </button>
                    </Tooltip>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {!searching && query.trim() && total === 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--s-7) var(--s-4)',
            gap: 'var(--s-2)',
            color: 'var(--fg-3)',
          }}
        >
          <Search size={24} strokeWidth={1.2} />
          <span style={{ fontSize: 'var(--t-sm)', fontFamily: 'var(--font-mono)' }}>No results</span>
        </div>
      )}

      {selectedFileResult && (
        <FilePreviewStrip
          result={selectedFileResult}
          content={previewContent}
          loading={previewLoading}
        />
      )}

      <div
        style={{
          display: 'flex',
          gap: 'var(--s-4)',
          padding: 'var(--s-2) var(--s-4)',
          background: 'var(--bg-1)',
          borderTop: '1px solid var(--line-2)',
          flexShrink: 0,
        }}
      >
        {[
          { key: '↑↓', label: 'NAVIGATE' },
          ...(total > 0 && selectedIndex < sessionItems.length
            ? [
                { key: '↵', label: 'SCOPE' },
                { key: isMac ? '⌘↵' : 'Ctrl+↵', label: 'FOCUS' },
              ]
            : [{ key: '↵', label: 'OPEN' }]),
          ...(scopedSession && query === '' ? [{ key: '⌫', label: 'CLEAR SCOPE' }] : []),
          { key: 'Esc', label: 'CLOSE' },
        ].map(({ key, label }) => (
          <span key={key} className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Kbd>{key}</Kbd>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

interface FilePreviewStripProps {
  result: import('@argus/shared').FileSearchResult;
  content: string | null;
  loading: boolean;
}

function FilePreviewStrip({ result, content, loading }: FilePreviewStripProps) {
  const isContent = result.matchType === 'content';
  const lineNumber = result.lineNumber;

  const codeLines = (() => {
    if (!content) return [];
    const all = content.split('\n');
    const matchIdx = lineNumber != null ? lineNumber - 1 : 0;
    const start = Math.max(0, matchIdx - 3);
    const end = Math.min(all.length, matchIdx + 5);
    return all.slice(start, end).map((text, i) => ({ text, num: start + i + 1 }));
  })();

  return (
    <div
      style={{
        borderTop: '1px solid var(--line-2)',
        display: 'flex',
        flexDirection: 'row',
        height: 148,
        flexShrink: 0,
        overflow: 'hidden',
        background: 'var(--bg-1)',
      }}
    >
      {/* Left: file info */}
      <div
        style={{
          width: 152,
          flexShrink: 0,
          borderRight: '1px solid var(--line-2)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 6,
          padding: '10px 14px',
          background: 'var(--bg-1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <FileText size={12} strokeWidth={1.6} style={{ color: 'var(--fg-3)', flexShrink: 0 }} />
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-sm)',
              color: 'var(--fg-0)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {result.name}
          </span>
        </div>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-micro)',
            textTransform: 'uppercase' as const,
            letterSpacing: 'var(--tracking-eye)',
            padding: '1px 5px',
            borderRadius: 'var(--r-1)',
            alignSelf: 'flex-start',
            color: isContent ? 'var(--fg-3)' : 'var(--accent)',
            background: isContent ? 'var(--bg-0)' : 'var(--accent-bg)',
            border: `1px solid ${isContent ? 'var(--line-2)' : 'var(--accent-edge)'}`,
          }}
        >
          {result.matchType}
        </span>
        {isContent && lineNumber != null && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-micro)',
              color: 'var(--accent)',
              letterSpacing: '0.04em',
            }}
          >
            line {lineNumber}
          </span>
        )}
      </div>

      {/* Right: code preview */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        {loading && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-sm)',
              color: 'var(--fg-3)',
              padding: '0 12px',
            }}
          >
            Loading…
          </span>
        )}
        {!loading && codeLines.length === 0 && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-sm)',
              color: 'var(--fg-3)',
              padding: '0 12px',
            }}
          >
            No preview
          </span>
        )}
        {!loading && codeLines.map(({ text, num }) => {
          const isMatch = num === lineNumber;
          return (
            <div
              key={num}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--t-tiny)',
                lineHeight: '1.65',
                paddingLeft: isMatch ? 10 : 12,
                paddingRight: 12,
                borderLeft: `2px solid ${isMatch ? 'var(--accent)' : 'transparent'}`,
                background: isMatch ? 'var(--accent-bg)' : 'transparent',
                whiteSpace: 'pre' as const,
                overflow: 'hidden',
              }}
            >
              <span
                style={{
                  color: isMatch ? 'color-mix(in srgb, var(--accent) 65%, transparent)' : 'var(--fg-4)',
                  minWidth: 28,
                  textAlign: 'right' as const,
                  marginRight: 12,
                  flexShrink: 0,
                  fontSize: 10,
                }}
              >
                {num}
              </span>
              <span
                style={{
                  color: isMatch ? 'var(--fg-0)' : 'var(--fg-2)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {text || ' '}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
