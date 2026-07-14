import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionInfo, FileSearchResult } from '@argus/shared';
import { Search, FileText, FileCode, FileJson, GitCommit, FolderOpen, Terminal } from 'lucide-react';
import { isMac, isPrimaryModifier } from '../../utils/platform.js';
import { api } from '../../services/api.js';
import { Kbd, Tooltip, StatusPill } from '../../components/primitives/index.js';
import { AgentGlyph } from '../ui/AgentGlyph.js';

const SHORTCUT = isMac ? '⌘K' : 'Ctrl+K';

type Scope = 'all' | 'files' | 'sessions';
const SCOPES: Scope[] = ['all', 'files', 'sessions'];

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
  const [scope, setScope] = useState<Scope>('all');
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

  const scopeToSession = (id: string) => {
    setScopedSessionId(id);
    setQuery('');
    setSelectedIndex(0);
    inputRef.current?.focus();
  };

  // Session-jump items, filtered by query. Hidden when the Files scope tab is active.
  const sessionItems = useMemo(
    () => sessions
      .filter((s) =>
        !query.trim() ||
        s.name.toLowerCase().includes(query.toLowerCase()) ||
        s.folderPath.toLowerCase().includes(query.toLowerCase()),
      )
      .slice(0, 5),
    [sessions, query],
  );

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

  // Scope tabs filter which groups are visible/navigable. Files requires a scoped
  // session to search within (otherwise empty + a hint).
  const visibleSessions = useMemo(() => (scope === 'files' ? [] : sessionItems), [scope, sessionItems]);
  const visibleResults = useMemo(() => (scope === 'sessions' ? [] : results), [scope, results]);
  const total = visibleSessions.length + visibleResults.length;

  // Keep selection in range as the visible list grows/shrinks. Adjust-during-render.
  if (selectedIndex > Math.max(0, total - 1)) {
    setSelectedIndex(Math.max(0, total - 1));
  }

  const cycleScope = (dir: 1 | -1) => {
    setScope((cur) => SCOPES[(SCOPES.indexOf(cur) + dir + SCOPES.length) % SCOPES.length]);
    setSelectedIndex(0);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        cycleScope(e.shiftKey ? -1 : 1);
        return;
      }
      // Backspace on an empty query clears the scoped session (back to session-pick).
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
        if (selectedIndex < visibleSessions.length) {
          const id = visibleSessions[selectedIndex].id;
          // ⌘Enter jumps to focus view; plain Enter scopes the palette.
          if (isPrimaryModifier(e)) {
            onJumpSession(id);
          } else {
            scopeToSession(id);
          }
        } else {
          const r = visibleResults[selectedIndex - visibleSessions.length];
          if (r && scopedSession) {
            onOpenInExplorer(scopedSession.id, r.path, r.lineNumber, query);
          }
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [selectedIndex, total, visibleSessions, visibleResults, query, scopedSession, onClose, onJumpSession, onOpenInExplorer]);

  useEffect(() => {
    const item = document.getElementById(optionId(selectedIndex));
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Selected row resolution (file vs session) for the preview pane.
  const fileIdx = selectedIndex - visibleSessions.length;
  const selectedFileResult: FileSearchResult | null =
    fileIdx >= 0 && fileIdx < visibleResults.length ? visibleResults[fileIdx] : null;
  const selectedSession: SessionInfo | null =
    selectedIndex < visibleSessions.length ? visibleSessions[selectedIndex] : null;

  // Clear the preview when no file row is selected (adjust-during-render); the
  // effect below only fetches a preview for a selected file row.
  const previewFileSelected = !!selectedFileResult;
  const [previewActive, setPreviewActive] = useState(false);
  if (previewActive !== previewFileSelected) {
    setPreviewActive(previewFileSelected);
    if (!previewFileSelected) {
      setPreviewContent(null);
      setPreviewLoading(false);
    }
  }

  useEffect(() => {
    if (!selectedFileResult) return;
    const r = selectedFileResult;
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
    }, 180);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFileResult?.path]);

  const rootPath = scopedSession?.folderPath ?? '';
  const showResultsRegion = total > 0 || searching;

  const scopeCounts: Record<Scope, number> = {
    all: sessionItems.length + results.length,
    files: results.length,
    sessions: sessionItems.length,
  };

  return (
    <div
      style={{
        background: 'var(--bg-2)',
        border: '1px solid var(--line-3)',
        borderRadius: 'var(--r-3)',
        boxShadow: 'var(--shadow-pop)',
        width: 'min(92vw, 900px)',
        height: '66vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Search row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: 'var(--s-3) var(--s-4)',
          borderBottom: '1px solid var(--line-2)',
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
          placeholder={scopedSession ? `Search in ${scopedSession.name}…` : 'Search everywhere — jump to a session…'}
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

      {/* Scope tabs */}
      <div
        role="tablist"
        aria-label="Search scope"
        style={{ display: 'flex', gap: 2, padding: '0 var(--s-3)', background: 'var(--bg-1)', borderBottom: '1px solid var(--line-2)', flexShrink: 0 }}
      >
        {SCOPES.map((sc) => {
          const on = scope === sc;
          return (
            <button
              key={sc}
              role="tab"
              aria-selected={on}
              onClick={() => { setScope(sc); setSelectedIndex(0); inputRef.current?.focus(); }}
              style={{
                all: 'unset',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--t-xs)',
                color: on ? 'var(--accent)' : 'var(--fg-2)',
                borderBottom: `2px solid ${on ? 'var(--accent)' : 'transparent'}`,
              }}
            >
              {sc[0].toUpperCase() + sc.slice(1)}
              <span
                style={{
                  fontSize: 'var(--t-micro)',
                  color: on ? 'var(--accent)' : 'var(--fg-3)',
                  background: on ? 'var(--accent-bg)' : 'var(--bg-3)',
                  borderRadius: 10,
                  padding: '0 6px',
                }}
              >
                {scopeCounts[sc]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Two-pane body: results | preview */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          className="argus-scroll"
          style={{ width: '46%', minWidth: 320, overflowY: 'auto', borderRight: '1px solid var(--line-2)' }}
        >
          {visibleSessions.length > 0 && (
            <div>
              <div className="eyebrow" style={{ padding: 'var(--s-2) var(--s-4)', color: 'var(--fg-3)' }}>SESSIONS</div>
              {visibleSessions.map((s, i) => {
                const isSelected = selectedIndex === i;
                return (
                  <div
                    key={s.id}
                    id={optionId(i)}
                    role="option"
                    aria-selected={isSelected}
                    onClick={(e) => (e.metaKey || e.ctrlKey ? onJumpSession(s.id) : scopeToSession(s.id))}
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
                    <Terminal size={13} strokeWidth={1.6} style={{ flexShrink: 0, color: isSelected ? 'var(--accent)' : 'var(--fg-3)' }} />
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--t-sm)',
                        fontWeight: 500,
                        color: isSelected ? 'var(--accent)' : 'var(--fg-0)',
                        flex: '0 1 auto',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {s.name}
                    </span>
                    <span style={{ flex: 1 }} />
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--t-micro)',
                        color: 'var(--fg-3)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {s.folderPath.split('/').slice(-2).join('/')}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {visibleResults.length > 0 && (
            <div>
              <div className="eyebrow" style={{ padding: 'var(--s-2) var(--s-4)', color: 'var(--fg-3)' }}>FILES</div>
              {visibleResults.map((r, idx) => {
                const i = idx + visibleSessions.length;
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
                    {/* Single-line (IntelliJ): name left, path right-aligned. */}
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--t-sm)',
                        color: isSelected ? 'var(--accent)' : 'var(--fg-0)',
                        flex: '0 1 auto',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {r.name}
                    </span>
                    <span style={{ flex: 1 }} />
                    {dir && (
                      <span
                        className="eyebrow"
                        style={{ color: 'var(--fg-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '45%' }}
                      >
                        {dir}
                      </span>
                    )}
                    <span
                      className="eyebrow"
                      style={{
                        color: r.matchType === 'filename' ? 'var(--accent)' : 'var(--fg-3)',
                        background: r.matchType === 'filename' ? 'var(--accent-bg)' : 'var(--bg-1)',
                        border: `1px solid ${r.matchType === 'filename' ? 'var(--accent-edge)' : 'var(--line-2)'}`,
                        padding: '1px 5px',
                        borderRadius: 'var(--r-1)',
                        flexShrink: 0,
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
                          flexShrink: 0,
                        }}
                      >
                        <GitCommit size={12} strokeWidth={1.6} />
                      </button>
                    </Tooltip>
                  </div>
                );
              })}
            </div>
          )}

          {!showResultsRegion && scope === 'files' && !scopedSession && (
            <div className="empty-hint" style={emptyHintStyle}>
              <FolderOpen size={22} strokeWidth={1.2} />
              <span>Pick a session first to search its files.</span>
            </div>
          )}
          {!searching && query.trim() && total === 0 && !(scope === 'files' && !scopedSession) && (
            <div className="empty-hint" style={emptyHintStyle}>
              <Search size={22} strokeWidth={1.2} />
              <span>No results</span>
            </div>
          )}
          {searching && total === 0 && (
            <div className="empty-hint" style={emptyHintStyle}>
              <span>Searching…</span>
            </div>
          )}
        </div>

        {/* Preview pane */}
        <PalettePreviewPane
          fileResult={selectedFileResult}
          session={selectedSession}
          content={previewContent}
          loading={previewLoading}
        />
      </div>

      {/* Footer hints */}
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
          ...(total > 0 && selectedIndex < visibleSessions.length
            ? [
                { key: '↵', label: 'SCOPE' },
                { key: isMac ? '⌘↵' : 'Ctrl+↵', label: 'FOCUS' },
              ]
            : [{ key: '↵', label: 'OPEN' }]),
          { key: 'Tab', label: 'SCOPE' },
          ...(scopedSession && query === '' ? [{ key: '⌫', label: 'CLEAR SCOPE' }] : []),
          { key: 'Esc', label: 'CLOSE' },
        ].map(({ key, label }) => (
          <span key={`${key}-${label}`} className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Kbd>{key}</Kbd>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

const emptyHintStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  gap: 'var(--s-2)',
  color: 'var(--fg-3)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--t-sm)',
  textAlign: 'center',
  padding: 'var(--s-6)',
};

interface PalettePreviewPaneProps {
  fileResult: FileSearchResult | null;
  session: SessionInfo | null;
  content: string | null;
  loading: boolean;
}

function PalettePreviewPane({ fileResult, session, content, loading }: PalettePreviewPaneProps) {
  if (session) {
    return (
      <div style={{ flex: 1, minWidth: 0, background: 'var(--bg-1)', display: 'flex', flexDirection: 'column', gap: 'var(--s-3)', padding: 'var(--s-5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
          <AgentGlyph agent={session.agentType} size={18} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-lg)', fontWeight: 600, color: 'var(--fg-0)' }}>
            {session.name}
          </span>
        </div>
        <StatusPill status={session.status} />
        <DetailRow k="PATH" v={session.folderPath} mono />
        <DetailRow k="AGENT" v={session.agentType ?? 'shell'} />
        {session.hasGitChanges && <DetailRow k="GIT" v="uncommitted changes" />}
        <div style={{ marginTop: 'auto', display: 'flex', gap: 'var(--s-3)', color: 'var(--fg-3)' }}>
          <span className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Kbd>↵</Kbd>SCOPE SEARCH</span>
          <span className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Kbd>{isMac ? '⌘↵' : 'Ctrl+↵'}</Kbd>JUMP TO FOCUS</span>
        </div>
      </div>
    );
  }

  if (!fileResult) {
    return (
      <div style={{ flex: 1, minWidth: 0, background: 'var(--bg-1)', display: 'grid', placeItems: 'center', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)' }}>
        Select a result to preview
      </div>
    );
  }

  const lineNumber = fileResult.lineNumber;
  const codeLines = (() => {
    if (!content) return [] as { text: string; num: number }[];
    const all = content.split('\n');
    const matchIdx = lineNumber != null ? lineNumber - 1 : 0;
    const start = Math.max(0, matchIdx - 8);
    const end = Math.min(all.length, matchIdx + 28);
    return all.slice(start, end).map((text, i) => ({ text, num: start + i + 1 }));
  })();

  return (
    <div style={{ flex: 1, minWidth: 0, background: 'var(--bg-1)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 'var(--s-3) var(--s-4)', borderBottom: '1px solid var(--line-2)', flexShrink: 0 }}>
        <FileText size={13} strokeWidth={1.6} style={{ color: 'var(--fg-3)', flexShrink: 0 }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)', color: 'var(--fg-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {fileResult.name}
        </span>
        <span style={{ flex: 1 }} />
        {fileResult.matchType === 'content' && lineNumber != null && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-micro)', color: 'var(--accent)' }}>line {lineNumber}</span>
        )}
      </div>
      <div className="argus-scroll" style={{ flex: 1, overflow: 'auto', padding: 'var(--s-2) 0' }}>
        {loading && <div style={{ padding: '0 14px', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)', color: 'var(--fg-3)' }}>Loading…</div>}
        {!loading && codeLines.length === 0 && <div style={{ padding: '0 14px', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)', color: 'var(--fg-3)' }}>No preview</div>}
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
                paddingLeft: isMatch ? 12 : 14,
                paddingRight: 14,
                borderLeft: `2px solid ${isMatch ? 'var(--accent)' : 'transparent'}`,
                background: isMatch ? 'var(--accent-bg)' : 'transparent',
                whiteSpace: 'pre',
                overflow: 'hidden',
              }}
            >
              <span
                style={{
                  color: isMatch ? 'color-mix(in srgb, var(--accent) 65%, transparent)' : 'var(--fg-4)',
                  minWidth: 34,
                  textAlign: 'right',
                  marginRight: 14,
                  flexShrink: 0,
                  fontSize: 10,
                }}
              >
                {num}
              </span>
              <span style={{ color: isMatch ? 'var(--fg-0)' : 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {text || ' '}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DetailRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--s-3)', fontSize: 'var(--t-xs)' }}>
      <span className="eyebrow" style={{ color: 'var(--fg-3)', width: 56, flexShrink: 0 }}>{k}</span>
      <span style={{ color: 'var(--fg-1)', fontFamily: mono ? 'var(--font-mono)' : 'inherit', wordBreak: 'break-all' }}>{v}</span>
    </div>
  );
}
