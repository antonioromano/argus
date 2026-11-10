import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionInfo, FileSearchResult } from '@argus/shared';
import { Search, FileText, FileCode, FileJson, GitCommit, FolderOpen, SquareTerminal, ChevronRight } from 'lucide-react';
import type { Command } from '../../commands/types.js';
import { frecency as appFrecency, type Frecency } from '../../commands/frecency.js';
import { browseCommands, rankCommands, recentCommands, suggestedCommands } from '../../commands/rank.js';
import { formatCombo } from '../../keyboard/combo.js';
import { isMac, isPrimaryModifier } from '../../utils/platform.js';
import { api } from '../../services/api.js';
import { Kbd, Tooltip, StatusPill, Icon, Stack, Row, Text, Spacer } from '../../components/primitives/index.js';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import { displayLabel } from '../../utils/sessionLabel.js';
import { displayStatus } from '../../utils/displayStatus.js';

const SHORTCUT = isMac ? '⌘K' : 'Ctrl+K';

type Scope = 'all' | 'commands' | 'files' | 'sessions';
const SCOPES: Scope[] = ['all', 'commands', 'files', 'sessions'];

/** A leading character narrows the scope while it is there (VS Code, Raycast). */
const PREFIX_SCOPE: Readonly<Record<string, Scope>> = { '>': 'commands', '@': 'sessions', '#': 'files' };

/** A titled run of command rows (RECENT, SUGGESTED, or a category). */
interface CommandGroup {
  label: string;
  commands: readonly Command[];
}

interface CommandPaletteProps {
  sessions: SessionInfo[];
  /** Session the palette is scoped to on open (focused session), or null to open unscoped. */
  initialScopeSessionId: string | null;
  onClose: () => void;
  onJumpSession: (id: string) => void;
  onOpenInExplorer: (sessionId: string, filePath: string, lineNumber?: number, query?: string) => void;
  onOpenInDiff: (sessionId: string, fileName: string) => void;
  /** Runnable actions (the command registry), listed after the sessions. */
  commands?: readonly Command[];
  /** Run history behind Recent and the ranking boost. Defaults to the app's. */
  frecency?: Frecency;
}

function ResultIcon({ ext }: { ext: string }) {
  const style: React.CSSProperties = { flexShrink: 0, color: 'var(--fg-3)' };
  if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) return <Icon icon={FileCode} size="md" style={style} />;
  if (ext === '.json') return <Icon icon={FileJson} size="md" style={style} />;
  return <Icon icon={FileText} size="md" style={style} />;
}

export function CommandPalette({
  sessions,
  initialScopeSessionId,
  onClose,
  onJumpSession,
  onOpenInExplorer,
  onOpenInDiff,
  commands = [],
  frecency = appFrecency,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  // A prefix overrides the tab and is not part of what is matched.
  const prefixScope: Scope | undefined = PREFIX_SCOPE[query[0]];
  const activeScope = prefixScope ?? scope;
  const q = prefixScope ? query.slice(1).trimStart() : query;
  // Read once per open: a run closes the palette anyway.
  const [frecencyScores] = useState(() => frecency.scores());
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
        !q.trim() ||
        s.name.toLowerCase().includes(q.toLowerCase()) ||
        s.folderPath.toLowerCase().includes(q.toLowerCase()),
      )
      .slice(0, 5),
    [sessions, q],
  );

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  // Clear results when the query is emptied (adjust-during-render); the effect
  // below only runs the debounced search for an active query.
  const fileQuery = activeScope === 'all' || activeScope === 'files' ? q.trim() : '';
  const queryActive = !!fileQuery && !!scopedSession;
  const [searchActive, setSearchActive] = useState(false);
  if (searchActive !== queryActive) {
    setSearchActive(queryActive);
    if (!queryActive) {
      setResults([]);
      setSearching(false);
    }
  }

  useEffect(() => {
    if (!fileQuery || !scopedSession) return;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const resp = await api.searchFiles(scopedSession.folderPath, fileQuery);
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
  }, [fileQuery, scopedSession]);

  // Scope tabs filter which groups are visible/navigable. Files requires a scoped
  // session to search within (otherwise empty + a hint).
  const visibleSessions = useMemo(
    () => (activeScope === 'all' || activeScope === 'sessions' ? sessionItems : []),
    [activeScope, sessionItems],
  );
  // Empty query: Recent, then Suggested (or, in the Commands scope, everything
  // by category). Typed: ranked matches grouped by category, best group first.
  const commandGroups = useMemo((): CommandGroup[] => {
    if (q.trim()) {
      return rankCommands(commands, q, frecencyScores)
        .map((g) => ({ label: g.category.toUpperCase(), commands: g.commands }));
    }
    const recent = recentCommands(commands, frecencyScores);
    const rest = activeScope === 'commands'
      ? browseCommands(commands).map((g) => ({ label: g.category.toUpperCase(), commands: g.commands }))
      : [{ label: 'SUGGESTED', commands: suggestedCommands(commands, recent) }];
    return [{ label: 'RECENT', commands: recent }, ...rest].filter((g) => g.commands.length > 0);
  }, [commands, q, frecencyScores, activeScope]);
  const visibleGroups = activeScope === 'all' || activeScope === 'commands' ? commandGroups : NO_GROUPS;
  const commandItems = useMemo(() => commandGroups.flatMap((g) => g.commands), [commandGroups]);
  const visibleCommands = useMemo(() => visibleGroups.flatMap((g) => g.commands), [visibleGroups]);
  const visibleResults = useMemo(
    () => (activeScope === 'all' || activeScope === 'files' ? results : []),
    [activeScope, results],
  );
  const runCommand = (c: Command) => {
    frecency.record(c.id);
    c.run();
  };
  // Row order: sessions, then commands, then files — indices are contiguous.
  const commandsStart = visibleSessions.length;
  const filesStart = commandsStart + visibleCommands.length;
  const total = filesStart + visibleResults.length;

  // Keep selection in range as the visible list grows/shrinks. Adjust-during-render.
  if (selectedIndex > Math.max(0, total - 1)) {
    setSelectedIndex(Math.max(0, total - 1));
  }

  const cycleScope = (dir: 1 | -1) => {
    // Tab moves on from what is showing; a typed prefix gives way to the tab.
    setScope(SCOPES[(SCOPES.indexOf(activeScope) + dir + SCOPES.length) % SCOPES.length]);
    if (prefixScope) setQuery(q);
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
        } else if (selectedIndex < filesStart) {
          const c = visibleCommands[selectedIndex - commandsStart];
          if (c) runCommand(c);
        } else {
          const r = visibleResults[selectedIndex - filesStart];
          if (r && scopedSession) {
            onOpenInExplorer(scopedSession.id, r.path, r.lineNumber, fileQuery);
          }
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
    // runCommand/cycleScope/scopeToSession only read values listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex, total, visibleSessions, visibleCommands, visibleResults, commandsStart, filesStart, query, q, fileQuery, activeScope, prefixScope, frecency, scopedSession, onClose, onJumpSession, onOpenInExplorer]);

  useEffect(() => {
    const item = document.getElementById(optionId(selectedIndex));
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Selected row resolution (file vs session) for the preview pane.
  const fileIdx = selectedIndex - filesStart;
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

  const selectedCommand: Command | null =
    selectedIndex >= commandsStart && selectedIndex < filesStart ? visibleCommands[selectedIndex - commandsStart] ?? null : null;

  const scopeCounts: Record<Scope, number> = {
    all: sessionItems.length + commandItems.length + results.length,
    commands: commandItems.length,
    files: results.length,
    sessions: sessionItems.length,
  };

  return (
    <Stack
      style={{
        background: 'var(--bg-2)',
        border: '1px solid var(--line-3)',
        borderRadius: 'var(--r-3)',
        boxShadow: 'var(--shadow-pop)',
        width: 'min(92vw, 900px)',
        height: '66vh',
        overflow: 'hidden',
      }}
    >
      {/* Search row */}
      <Row gap={3} style={{ padding: 'var(--s-3) var(--s-4)', borderBottom: '1px solid var(--line-2)' }}>
        <Icon icon={Search} size="md" style={{ color: 'var(--accent)', flexShrink: 0 }} />
        {scopedSession && (
          <Row
            as="span"
            gap={1.5}
            style={{
              flexShrink: 0,
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-tiny)',
              color: 'var(--accent)',
              background: 'var(--accent-bg)',
              border: '1px solid var(--accent-edge)',
              borderRadius: 'var(--r-1)',
              padding: 'var(--s-0-5) var(--s-2)',
              whiteSpace: 'nowrap',
            }}
          >
            <Icon icon={FolderOpen} size="sm" />
            {scopedSession.name}
            <button
              aria-label="Clear scope"
              onClick={() => { setScopedSessionId(null); setSelectedIndex(0); inputRef.current?.focus(); }}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                marginLeft: 'var(--s-0-5)',
                color: 'var(--accent)',
                opacity: 0.55,
                fontSize: 'var(--t-caption)',
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </Row>
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
          placeholder={scopedSession ? `Search in ${scopedSession.name}…` : 'Search everywhere — > commands · @ sessions · # files'}
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
      </Row>

      {/* Scope tabs */}
      <Row
        align="stretch"
        gap={0.5}
        role="tablist"
        aria-label="Search scope"
        style={{
          padding: '0 var(--s-3)',
          background: 'var(--bg-1)',
          borderBottom: '1px solid var(--line-2)',
          flexShrink: 0,
        }}
      >
        {SCOPES.map((sc) => {
          const on = activeScope === sc;
          return (
            <button
              key={sc}
              role="tab"
              aria-selected={on}
              onClick={() => { setScope(sc); if (prefixScope) setQuery(q); setSelectedIndex(0); inputRef.current?.focus(); }}
              style={{
                all: 'unset',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--s-1-5)',
                padding: 'var(--s-2) var(--s-4)',
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
                  borderRadius: 'var(--r-4)',
                  padding: '0 var(--s-1-5)',
                }}
              >
                {scopeCounts[sc]}
              </span>
            </button>
          );
        })}
      </Row>

      {/* Two-pane body: results | preview */}
      <Row align="stretch" style={{ flex: 1, minHeight: 0 }}>
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
                  <Row
                    gap={3}
                    key={s.id}
                    id={optionId(i)}
                    role="option"
                    aria-selected={isSelected}
                    onClick={(e) => (e.metaKey || e.ctrlKey ? onJumpSession(s.id) : scopeToSession(s.id))}
                    onMouseEnter={() => setSelectedIndex(i)}
                    style={{
                      padding: 'var(--s-2) var(--s-4)',
                      cursor: 'pointer',
                      background: isSelected ? 'var(--bg-3)' : 'transparent',
                      borderLeft: `2px solid ${isSelected ? 'var(--accent)' : 'transparent'}`,
                    }}
                  >
                    <Icon icon={SquareTerminal} size="md" style={{ flexShrink: 0, color: isSelected ? 'var(--accent)' : 'var(--fg-3)' }} />
                    <Text
                      mono
                      size="body"
                      weight={500}
                      truncate
                      style={{ color: isSelected ? 'var(--accent)' : 'var(--fg-0)', flex: '0 1 auto' }}
                    >
                      {displayLabel(s)}
                    </Text>
                    <Spacer />
                    <Text mono size="eyebrow" tone="faint" style={{ whiteSpace: 'nowrap' }}>
                      {s.folderPath.split('/').slice(-2).join('/')}
                    </Text>
                  </Row>
                );
              })}
            </div>
          )}

          {visibleGroups.map((g, gi) => {
            const groupStart = commandsStart + visibleGroups.slice(0, gi).reduce((n, x) => n + x.commands.length, 0);
            return (
              <div key={g.label} role="group" aria-label={g.label}>
                <div className="eyebrow argus-cmd-eyebrow">{g.label}</div>
                {g.commands.map((c, idx) => {
                  const i = groupStart + idx;
                  const Glyph = c.icon ?? ChevronRight;
                  return (
                    <div
                      key={c.id}
                      id={optionId(i)}
                      role="option"
                      aria-selected={selectedIndex === i}
                      data-destructive={c.destructive || undefined}
                      className="argus-cmd-row"
                      onClick={() => runCommand(c)}
                      onMouseEnter={() => setSelectedIndex(i)}
                    >
                      <span className="argus-cmd-check" aria-label={c.checked ? 'on' : undefined}>{c.checked ? '✓' : ''}</span>
                      <Icon icon={Glyph} size="md" className="argus-cmd-icon" />
                      <span className="argus-cmd-title">{c.title}</span>
                      <span className="argus-cmd-fill" />
                      {c.hint && <span className="argus-cmd-hint">{c.hint}</span>}
                      {c.shortcut && <Kbd>{formatCombo(c.shortcut)}</Kbd>}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {visibleResults.length > 0 && (
            <div>
              <div className="eyebrow" style={{ padding: 'var(--s-2) var(--s-4)', color: 'var(--fg-3)' }}>FILES</div>
              {visibleResults.map((r, idx) => {
                const i = idx + filesStart;
                const isSelected = selectedIndex === i;
                const rel = r.path.startsWith(rootPath) ? r.path.slice(rootPath.length + 1) : r.path;
                const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
                return (
                  <Row
                    gap={3}
                    key={r.path}
                    id={optionId(i)}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => { if (scopedSession) { onOpenInExplorer(scopedSession.id, r.path, r.lineNumber, fileQuery); } }}
                    onMouseEnter={() => setSelectedIndex(i)}
                    style={{
                      padding: 'var(--s-2) var(--s-4)',
                      cursor: 'pointer',
                      background: isSelected ? 'var(--bg-3)' : 'transparent',
                      borderLeft: `2px solid ${isSelected ? 'var(--accent)' : 'transparent'}`,
                    }}
                  >
                    <ResultIcon ext={r.ext} />
                    {/* Single-line (IntelliJ): name left, path right-aligned. */}
                    <Text mono size="body" truncate style={{ color: isSelected ? 'var(--accent)' : 'var(--fg-0)', flex: '0 1 auto' }}>
                      {r.name}
                    </Text>
                    <Spacer />
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
                        padding: 'var(--s-px) var(--s-1-5)',
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
                          padding: 'var(--s-0-5)',
                          color: isSelected ? 'var(--accent)' : 'var(--fg-3)',
                          opacity: isSelected ? 1 : 0,
                          transition: 'opacity var(--dur-fast)',
                          flexShrink: 0,
                        }}
                      >
                        <Icon icon={GitCommit} size="sm" />
                      </button>
                    </Tooltip>
                  </Row>
                );
              })}
            </div>
          )}

          {!showResultsRegion && activeScope === 'files' && !scopedSession && (
            <div className="empty-hint" style={emptyHintStyle}>
              <Icon icon={FolderOpen} size="xl" />
              <span>Pick a session first to search its files.</span>
            </div>
          )}
          {!searching && q.trim() && total === 0 && !(activeScope === 'files' && !scopedSession) && (
            <div className="empty-hint" style={emptyHintStyle}>
              <Icon icon={Search} size="xl" />
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
          command={selectedCommand}
          fileResult={selectedFileResult}
          session={selectedSession}
          content={previewContent}
          loading={previewLoading}
        />
      </Row>

      {/* Footer hints */}
      <Row
        align="stretch"
        gap={4}
        style={{
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
            : [{ key: '↵', label: selectedCommand ? 'RUN' : 'OPEN' }]),
          { key: 'Tab', label: 'SCOPE' },
          ...(scopedSession && query === '' ? [{ key: '⌫', label: 'CLEAR SCOPE' }] : []),
          { key: 'Esc', label: 'CLOSE' },
        ].map(({ key, label }) => (
          <Row as="span" key={`${key}-${label}`} gap={1.5} className="eyebrow">
            <Kbd>{key}</Kbd>
            {label}
          </Row>
        ))}
      </Row>
    </Stack>
  );
}

const NO_GROUPS: readonly CommandGroup[] = [];

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
  command: Command | null;
  fileResult: FileSearchResult | null;
  session: SessionInfo | null;
  content: string | null;
  loading: boolean;
}

function PalettePreviewPane({ command, fileResult, session, content, loading }: PalettePreviewPaneProps) {
  if (command) {
    const Glyph = command.icon ?? ChevronRight;
    return (
      <Stack gap={3} grow style={{ background: 'var(--bg-1)', padding: 'var(--s-5)' }}>
        <Row gap={2}>
          <Icon icon={Glyph} size="lg" style={{ color: 'var(--accent)' }} />
          <Text mono size="title" weight={600} style={{ color: 'var(--fg-0)' }}>
            {command.title}
          </Text>
        </Row>
        {command.hint && <DetailRow k="DETAIL" v={command.hint} mono />}
        <DetailRow k="CATEGORY" v={command.category} />
        {command.shortcut && <DetailRow k="SHORTCUT" v={formatCombo(command.shortcut)} mono />}
        <DetailRow k="SOURCE" v={command.source} />
        <Row align="stretch" gap={3} style={{ marginTop: 'auto', color: 'var(--fg-3)' }}>
          <Row as="span" gap={1.5} className="eyebrow"><Kbd>↵</Kbd>RUN</Row>
        </Row>
      </Stack>
    );
  }

  if (session) {
    return (
      <Stack gap={3} grow style={{ background: 'var(--bg-1)', padding: 'var(--s-5)' }}>
        <Row gap={2}>
          <AgentGlyph agent={session.agentType} size={18} />
          <Text mono size="title" weight={600} style={{ color: 'var(--fg-0)' }}>
            {displayLabel(session)}
          </Text>
        </Row>
        <StatusPill status={displayStatus(session)} />
        <DetailRow k="PATH" v={session.folderPath} mono />
        <DetailRow k="AGENT" v={session.agentType ?? 'shell'} />
        {session.hasGitChanges && <DetailRow k="GIT" v="uncommitted changes" />}
        <Row align="stretch" gap={3} style={{ marginTop: 'auto', color: 'var(--fg-3)' }}>
          <Row as="span" gap={1.5} className="eyebrow"><Kbd>↵</Kbd>SCOPE SEARCH</Row>
          <Row as="span" gap={1.5} className="eyebrow"><Kbd>{isMac ? '⌘↵' : 'Ctrl+↵'}</Kbd>JUMP TO FOCUS</Row>
        </Row>
      </Stack>
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
    <Stack grow style={{ background: 'var(--bg-1)', overflow: 'hidden' }}>
      <Row gap={2} style={{ padding: 'var(--s-3) var(--s-4)', borderBottom: '1px solid var(--line-2)', flexShrink: 0 }}>
        <Icon icon={FileText} size="md" style={{ color: 'var(--fg-3)', flexShrink: 0 }} />
        <Text mono size="body" truncate style={{ color: 'var(--fg-0)' }}>
          {fileResult.name}
        </Text>
        <Spacer />
        {fileResult.matchType === 'content' && lineNumber != null && (
          <Text mono size="eyebrow" tone="accent">line {lineNumber}</Text>
        )}
      </Row>
      <div className="argus-scroll" style={{ flex: 1, overflow: 'auto', padding: 'var(--s-2) 0' }}>
        {loading && <Text as="div" mono size="body" tone="faint" style={{ padding: '0 var(--s-4)' }}>Loading…</Text>}
        {!loading && codeLines.length === 0 && <Text as="div" mono size="body" tone="faint" style={{ padding: '0 var(--s-4)' }}>No preview</Text>}
        {!loading && codeLines.map(({ text, num }) => {
          const isMatch = num === lineNumber;
          return (
            <Row
              align="baseline"
              key={num}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--t-tiny)',
                lineHeight: '1.65',
                paddingLeft: isMatch ? 'var(--s-3)' : 'var(--s-4)',
                paddingRight: 'var(--s-4)',
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
                  marginRight: 'var(--s-4)',
                  flexShrink: 0,
                  fontSize: 'var(--t-eyebrow)',
                }}
              >
                {num}
              </span>
              <span style={{ color: isMatch ? 'var(--fg-0)' : 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {text || ' '}
              </span>
            </Row>
          );
        })}
      </div>
    </Stack>
  );
}

function DetailRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <Row align="stretch" gap={3} style={{ fontSize: 'var(--t-xs)' }}>
      <span className="eyebrow" style={{ color: 'var(--fg-3)', width: 56, flexShrink: 0 }}>{k}</span>
      <span style={{ color: 'var(--fg-1)', fontFamily: mono ? 'var(--font-mono)' : 'inherit', wordBreak: 'break-all' }}>{v}</span>
    </Row>
  );
}
