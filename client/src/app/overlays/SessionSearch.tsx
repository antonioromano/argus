import { useEffect, useMemo, useRef, useState } from 'react';
import type { SearchHit, SearchResponse } from '@argus/shared';
import { Search, Loader2 } from 'lucide-react';
import { Kbd, Icon } from '../../components/primitives/index.js';
import { AgentGlyph } from '../ui/AgentGlyph.js';

export const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY = 2;

interface SessionSearchProps {
  /** Runs one search; aborted when the query changes. */
  search: (q: string, signal: AbortSignal) => Promise<SearchResponse>;
  /** Display label of the shortcut (e.g. ⌘⇧F). */
  shortcutLabel?: string;
  onClose: () => void;
  /** Focus the session; for a scrollback hit, also scroll its terminal there. */
  onJump: (sessionId: string, hit: SearchHit, query: string) => void;
}

interface FlatHit {
  sessionId: string;
  hit: SearchHit;
}

/**
 * Cross-session search (F9): one box over every session's scrollback and, for
 * Claude sessions, its transcript. Results are grouped by session; ↑↓ moves
 * across all of them, ↵ (or a click) jumps to the session.
 */
export function SessionSearch({ search, shortcutLabel, onClose, onJump }: SessionSearchProps) {
  const [query, setQuery] = useState('');
  // The last finished search, tagged with its query; everything shown is
  // derived from it, so the effect only ever sets state from async callbacks.
  const [outcome, setOutcome] = useState<{ q: string; data?: SearchResponse; error?: string } | null>(null);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const q = query.trim();
  const active = q.length >= MIN_QUERY;
  const settled = outcome?.q === q;
  const loading = active && !settled;
  // While a new search runs, the previous results stay up.
  const data = active ? outcome?.data ?? null : null;
  const error = active && settled ? outcome?.error ?? null : null;

  useEffect(() => {
    if (q.length < MIN_QUERY) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      search(q, ctrl.signal)
        .then((res) => {
          if (ctrl.signal.aborted) return;
          setOutcome({ q, data: res });
          setSelected(0);
        })
        .catch((err: unknown) => {
          if (ctrl.signal.aborted) return;
          setOutcome({ q, error: err instanceof Error ? err.message : 'Search failed' });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, search]);

  const flat = useMemo<FlatHit[]>(
    () => (data?.results ?? []).flatMap((r) => r.hits.map((hit) => ({ sessionId: r.sessionId, hit }))),
    [data],
  );
  const current = flat[Math.min(selected, flat.length - 1)];

  const jump = (f: FlatHit | undefined) => {
    if (f && data) onJump(f.sessionId, f.hit, data.query);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (flat.length === 0) return;
      setSelected((i) => Math.min(flat.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      jump(current);
    }
  };

  useEffect(() => {
    if (current) document.getElementById(searchRowId(flat.indexOf(current)))?.scrollIntoView?.({ block: 'nearest' });
  }, [current, flat]);

  let index = -1;
  return (
    <div
      onKeyDown={onKeyDown}
      style={{
        background: 'var(--bg-2)',
        border: '1px solid var(--line-3)',
        borderRadius: 'var(--r-3)',
        boxShadow: 'var(--shadow-pop)',
        width: 'min(92vw, 760px)',
        maxHeight: '70vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 'var(--s-3) var(--s-4)', borderBottom: '1px solid var(--line-2)' }}>
        {loading
          ? <Icon icon={Loader2} size={14} strokeWidth={1.6} style={{ color: 'var(--accent)', flexShrink: 0, animation: 'argus-spin 0.9s linear infinite' }} />
          : <Icon icon={Search} size={14} strokeWidth={1.6} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Search all sessions"
          aria-expanded={flat.length > 0}
          aria-controls="session-search-results"
          aria-activedescendant={current ? searchRowId(flat.indexOf(current)) : undefined}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search every session's scrollback and transcript…"
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
        {shortcutLabel && <Kbd>{shortcutLabel}</Kbd>}
      </div>

      <div id="session-search-results" role="listbox" aria-label="Search results" className="argus-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {(error || (settled && data && flat.length === 0) || !active) && (
          <div
            className="empty-hint"
            style={{ padding: 'var(--s-6)', textAlign: 'center', color: error ? 'var(--warn)' : 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)' }}
          >
            {error ?? (!active ? 'Type at least two characters.' : `No matches for “${data?.query}”.`)}
          </div>
        )}
        {!error && data?.results.map((r) => (
          <div key={r.sessionId} role="group" aria-label={r.sessionName}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px var(--s-4) 4px', background: 'var(--bg-1)' }}>
              <AgentGlyph agent={r.agentType} size={14} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)', fontWeight: 500, color: 'var(--fg-0)' }}>{r.sessionName}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-micro)', color: 'var(--fg-3)' }}>
                {r.hits.length}{r.scrollback === 'frozen' ? ' · asleep' : ''}
              </span>
            </div>
            {r.hits.map((hit, i) => {
              index++;
              const myIndex = index;
              const isSelected = current === flat[myIndex];
              return (
                <div
                  key={i}
                  id={searchRowId(myIndex)}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => jump(flat[myIndex])}
                  onMouseEnter={() => setSelected(myIndex)}
                  style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'baseline',
                    padding: '6px var(--s-4)',
                    cursor: 'pointer',
                    background: isSelected ? 'var(--bg-3)' : 'transparent',
                    borderLeft: `2px solid ${isSelected ? 'var(--accent)' : 'transparent'}`,
                  }}
                >
                  <span className="eyebrow" style={{ flexShrink: 0, width: 72, color: 'var(--fg-3)' }}>
                    {hit.source === 'transcript' ? (hit.role === 'user' ? 'you' : 'agent') : 'terminal'}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)', color: 'var(--fg-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {hit.snippet.slice(0, hit.matchStart)}
                    <mark style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>{hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength)}</mark>
                    {hit.snippet.slice(hit.matchStart + hit.matchLength)}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 'var(--s-4)', padding: 'var(--s-2) var(--s-4)', background: 'var(--bg-1)', borderTop: '1px solid var(--line-2)', flexShrink: 0 }}>
        {[
          { key: '↑↓', label: 'NAVIGATE' },
          { key: '↵', label: 'JUMP' },
          { key: 'Esc', label: 'CLOSE' },
        ].map(({ key, label }) => (
          <span key={label} className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Kbd>{key}</Kbd>
            {label}
          </span>
        ))}
        <span style={{ flex: 1 }} />
        {data?.truncated && <span className="eyebrow" style={{ color: 'var(--fg-3)' }}>MORE RESULTS NOT SHOWN</span>}
      </div>
    </div>
  );
}

function searchRowId(i: number): string {
  return `session-search-row-${i}`;
}
