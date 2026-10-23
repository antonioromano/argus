import { useEffect, useMemo, useRef, useState } from 'react';
import type { FindInFilesResponse } from '@argus/shared';
import { Search, X, CaseSensitive, WholeWord, Regex, Ellipsis, ChevronRight, ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api, ApiError, type FindInFilesQuery } from '../../services/api.js';
import { Icon, scaledPx } from '../primitives/index.js';
import { ResultIcon } from './FileSearchPanel.js';
import { splitHighlights, flattenRows, type Row } from './findInFilesRows.js';

interface FindInFilesPanelProps {
  folderPath: string;
  query: string;
  onQueryChange: (q: string) => void;
  /** Bumped by ⌘⇧F while the panel is already open: refocus and select the query. */
  focusNonce: number;
  onOpenMatch: (path: string, line: number) => void;
  onClose: () => void;
}

type Options = FindInFilesQuery & { showFilters: boolean };

const OPTIONS_KEY = 'argus.explorer.findInFiles';
const DEFAULT_OPTIONS: Options = { regex: false, caseSensitive: false, wholeWord: false, include: '', exclude: '', showFilters: false };

function readOptions(): Options {
  try {
    const raw = window.localStorage.getItem(OPTIONS_KEY);
    return raw ? { ...DEFAULT_OPTIONS, ...(JSON.parse(raw) as Partial<Options>) } : DEFAULT_OPTIONS;
  } catch {
    return DEFAULT_OPTIONS;
  }
}

function writeOptions(o: Options): void {
  try {
    window.localStorage.setItem(OPTIONS_KEY, JSON.stringify(o));
  } catch {
    /* storage unavailable — options just don't persist */
  }
}

function ToggleButton({ icon, label, active, onClick }: { icon: LucideIcon; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 'var(--ctl-h-xs)',
        height: 'var(--ctl-h-xs)',
        flexShrink: 0,
        borderRadius: 'var(--r-1)',
        color: active ? 'var(--accent)' : 'var(--fg-3)',
        background: active ? 'var(--accent-bg)' : 'transparent',
        border: `1px solid ${active ? 'var(--accent-edge)' : 'transparent'}`,
        boxSizing: 'border-box',
      }}
    >
      <Icon icon={icon} size={14} strokeWidth={1.6} />
    </button>
  );
}

export function FindInFilesPanel({ folderPath, query, onQueryChange, focusNonce, onOpenMatch, onClose }: FindInFilesPanelProps) {
  const [options, setOptions] = useState<Options>(readOptions);
  const [result, setResult] = useState<FindInFilesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    el?.focus();
    el?.select();
  }, [focusNonce]);

  const patch = (p: Partial<Options>) =>
    setOptions((o) => {
      const next = { ...o, ...p };
      writeOptions(next);
      return next;
    });

  // Clear results when the query is emptied (adjust-during-render); the effect
  // below only searches for a non-empty query.
  const queryActive = !!query;
  const [wasActive, setWasActive] = useState(queryActive);
  if (wasActive !== queryActive) {
    setWasActive(queryActive);
    if (!queryActive) {
      setResult(null);
      setError(null);
      setSearching(false);
    }
  }

  // Debounced search; a newer keystroke aborts the request in flight.
  const { regex, caseSensitive, wholeWord, include, exclude } = options;
  useEffect(() => {
    if (!query) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const resp = await api.findInFiles(folderPath, query, { regex, caseSensitive, wholeWord, include, exclude }, ctrl.signal);
        setResult(resp);
        setError(null);
        setCollapsed(new Set());
        setSelected(0);
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setResult(null);
        setError(err instanceof ApiError ? err.message : 'Search failed');
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [folderPath, query, regex, caseSensitive, wholeWord, include, exclude]);

  const files = useMemo(() => result?.files ?? [], [result]);
  const rows = useMemo(() => flattenRows(files, collapsed), [files, collapsed]);

  const toggleFile = (p: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const activate = (row: Row | undefined) => {
    if (!row) return;
    const file = files[row.fi];
    if (row.kind === 'file') toggleFile(file.path);
    else onOpenMatch(file.path, file.matches[row.mi].line);
  };

  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${selected}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  // Capture phase so Escape doesn't bubble to the workbench and close the explorer.
  // The panel stays open while editing, so only keys typed inside it are handled.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.target instanceof Node) || !rootRef.current?.contains(e.target)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      // Arrows/Enter drive the result list only from the query box, so the
      // glob inputs and the editor keep their own caret keys.
      if (e.target !== inputRef.current) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((i) => Math.min(i + 1, rows.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && rows.length > 0) {
        e.preventDefault();
        activate(rows[selected]);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  });

  const relPath = (abs: string) => (abs.startsWith(folderPath) ? abs.slice(folderPath.length).replace(/^\//, '') : abs);

  let status: string | null = null;
  if (error) status = error;
  else if (searching && !result) status = 'Searching…';
  else if (result) {
    const n = result.totalMatches;
    status = n === 0
      ? 'No results'
      : `${n} result${n === 1 ? '' : 's'} in ${files.length} file${files.length === 1 ? '' : 's'}${result.truncated ? ' — showing the first, refine the search' : ''}`;
  }

  return (
    <div
      ref={rootRef}
      role="search"
      aria-label="Find in files"
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 8px', borderBottom: '1px solid var(--line-2)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ flex: 1, fontSize: 'var(--t-tiny)', letterSpacing: 'var(--tracking-eye)', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
            FIND IN FILES
          </span>
          <ToggleButton icon={Ellipsis} label="Toggle include/exclude filters" active={options.showFilters} onClick={() => patch({ showFilters: !options.showFilters })} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close find in files"
            style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 'var(--ctl-h-xs)', height: 'var(--ctl-h-xs)', color: 'var(--fg-3)' }}
          >
            <Icon icon={X} size={13} strokeWidth={1.6} />
          </button>
        </div>
        <div style={{ ...fieldBox, gap: 2 }}>
          <Icon icon={Search} size={13} strokeWidth={1.6} color="var(--fg-3)" style={{ flexShrink: 0, marginRight: 4 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search"
            aria-label="Search text"
            aria-invalid={!!error}
            spellCheck={false}
            style={inputStyle}
          />
          <ToggleButton icon={CaseSensitive} label="Match case" active={caseSensitive} onClick={() => patch({ caseSensitive: !caseSensitive })} />
          <ToggleButton icon={WholeWord} label="Match whole word" active={wholeWord} onClick={() => patch({ wholeWord: !wholeWord })} />
          <ToggleButton icon={Regex} label="Use regular expression" active={regex} onClick={() => patch({ regex: !regex })} />
        </div>
        {options.showFilters && (
          <>
            <input
              value={include}
              onChange={(e) => patch({ include: e.target.value })}
              placeholder="files to include (e.g. src/**, *.ts)"
              aria-label="Files to include"
              spellCheck={false}
              style={{ ...inputStyle, ...fieldBox, flex: 'none' }}
            />
            <input
              value={exclude}
              onChange={(e) => patch({ exclude: e.target.value })}
              placeholder="files to exclude (e.g. *.test.ts)"
              aria-label="Files to exclude"
              spellCheck={false}
              style={{ ...inputStyle, ...fieldBox, flex: 'none' }}
            />
          </>
        )}
        {status && (
          <div
            role={error ? 'alert' : 'status'}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-tiny)', color: error ? 'var(--danger)' : 'var(--fg-3)', overflowWrap: 'anywhere' }}
          >
            {status}
          </div>
        )}
      </div>

      <div
        ref={listRef}
        role="tree"
        aria-label="Find in files results"
        className="argus-scroll"
        style={{ flex: 1, overflowY: 'auto', minHeight: 0, opacity: searching && result ? 0.6 : 1 }}
      >
        {rows.map((row, ri) => {
          const file = files[row.fi];
          const isSel = ri === selected;
          const base: React.CSSProperties = {
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            minHeight: scaledPx(22),
            cursor: 'pointer',
            background: isSel ? 'var(--bg-3)' : 'transparent',
            borderLeft: `2px solid ${isSel ? 'var(--accent)' : 'transparent'}`,
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-xs)',
            minWidth: 0,
          };
          if (row.kind === 'file') {
            const open = !collapsed.has(file.path);
            const rel = relPath(file.path);
            const slash = rel.lastIndexOf('/');
            return (
              <div
                key={`f:${file.path}`}
                data-row={ri}
                role="treeitem"
                aria-expanded={open}
                aria-selected={isSel}
                onClick={() => { setSelected(ri); toggleFile(file.path); }}
                style={{ ...base, padding: '0 8px 0 4px' }}
                title={rel}
              >
                <Icon icon={open ? ChevronDown : ChevronRight} size={12} strokeWidth={1.6} color="var(--fg-3)" style={{ flexShrink: 0 }} />
                <ResultIcon ext={rel.slice(rel.lastIndexOf('.')).toLowerCase()} />
                <span style={{ color: 'var(--fg-0)', whiteSpace: 'nowrap', flexShrink: 0 }}>{rel.slice(slash + 1)}</span>
                <span style={{ color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                  {slash >= 0 ? rel.slice(0, slash) : ''}
                </span>
                <span style={{ color: 'var(--fg-2)', background: 'var(--bg-3)', borderRadius: 'var(--r-1)', padding: '0 5px', flexShrink: 0, fontSize: 'var(--t-tiny)' }}>
                  {file.matches.length}
                </span>
              </div>
            );
          }
          const m = file.matches[row.mi];
          return (
            <div
              key={`m:${file.path}:${m.line}`}
              data-row={ri}
              role="treeitem"
              aria-selected={isSel}
              onClick={() => { setSelected(ri); onOpenMatch(file.path, m.line); }}
              style={{ ...base, padding: '0 8px 0 26px' }}
              title={`${relPath(file.path)}:${m.line}`}
            >
              <span style={{ color: 'var(--fg-3)', flexShrink: 0, minWidth: '3ch', textAlign: 'right' }}>{m.line}</span>
              <span style={{ color: 'var(--fg-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'pre', flex: 1, minWidth: 0 }}>
                {splitHighlights(m.preview, m.ranges).map((seg, si) =>
                  seg.hit
                    ? <mark key={si} style={{ background: 'var(--accent-bg)', color: 'var(--accent)', outline: '1px solid var(--accent-edge)', borderRadius: 2 }}>{seg.text}</mark>
                    : <span key={si}>{seg.text}</span>,
                )}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 12, padding: '4px 10px', borderTop: '1px solid var(--line-2)', flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--t-tiny)', color: 'var(--fg-3)' }}>
        <span>↑↓ navigate</span>
        <span>↵ open</span>
        <span>Esc close</span>
      </div>
    </div>
  );
}

const fieldBox: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  height: 'var(--ctl-h-sm)',
  padding: '0 4px 0 6px',
  background: 'var(--bg-2)',
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--r-1)',
  boxSizing: 'border-box',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: 'none',
  border: 'none',
  outline: 'none',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--t-sm)',
  color: 'var(--fg-0)',
};
