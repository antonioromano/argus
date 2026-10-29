import { useState } from 'react';
import { ListChecks, Search } from 'lucide-react';
import { GROUP_ORDER, type PaneDef, type PaneId } from './registry.js';
import { visiblePanes, type SettingHit } from './search.js';
import { Icon } from '../../../components/primitives/index.js';

/** Hits listed under one pane; the rest are a refinement of the query away. */
const MAX_HITS_PER_PANE = 4;

interface SettingsNavProps {
  /** The open pane, or the virtual Modified view. */
  active: PaneId | 'modified';
  onSelect: (id: PaneId) => void;
  /** Panes holding at least one non-default value — rendered with an amber dot. */
  modified: Set<PaneId>;
  query: string;
  onQuery: (next: string) => void;
  /** Controls matching the query, best first (see searchSettings). */
  hits: SettingHit[];
  /** Open a setting: its pane, scrolled to and flashed. */
  onGoTo: (settingId: string) => void;
  /** Settings differing from their default; the pinned Modified entry shows while > 0. */
  modifiedCount: number;
  onShowModified: () => void;
}

type Entry = { kind: 'pane'; pane: PaneId } | { kind: 'hit'; pane: PaneId; id: string };

/**
 * The sidebar: a filter box over twelve single-topic panes in four groups.
 *
 * With a query, each matching pane also lists the matching controls under it,
 * so "which row holds X" is answered here, not by scanning the pane. Arrow keys
 * walk panes and hits; Enter opens the selected hit, or the best one.
 */
export function SettingsNav({ active, onSelect, modified, query, onQuery, hits, onGoTo, modifiedCount, onShowModified }: SettingsNavProps) {
  const visible = visiblePanes(query, hits);
  const [cursorHit, setCursorHit] = useState<string | null>(null);

  const hitsFor = (pane: PaneId) => hits.filter((h) => h.setting.pane === pane).slice(0, MAX_HITS_PER_PANE);
  const byGroup = (group: PaneDef['group']) => visible.filter((p) => p.group === group);

  // Render order, which is also the order the arrow keys walk.
  const entries: Entry[] = GROUP_ORDER.flatMap((g) => byGroup(g)).flatMap((p) => [
    { kind: 'pane' as const, pane: p.id },
    ...hitsFor(p.id).map((h) => ({ kind: 'hit' as const, pane: p.id, id: h.setting.id })),
  ]);
  // A cursor left on a hit the new query no longer lists falls back to the pane.
  const cursor = entries.some((e) => e.kind === 'hit' && e.id === cursorHit) ? cursorHit : null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      const id = cursor ?? hits[0]?.setting.id;
      if (!id) return;
      e.preventDefault();
      onGoTo(id);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (entries.length === 0) return;
    e.preventDefault();
    const idx = entries.findIndex((en) => (cursor
      ? en.kind === 'hit' && en.id === cursor
      : en.kind === 'pane' && en.pane === active));
    const next = entries[e.key === 'ArrowDown'
      ? (idx + 1) % entries.length
      : (idx - 1 + entries.length) % entries.length];
    onSelect(next.pane);
    setCursorHit(next.kind === 'hit' ? next.id : null);
  };

  return (
    <aside
      role="tablist"
      aria-orientation="vertical"
      aria-label="Settings sections"
      onKeyDown={onKeyDown}
      style={{
        width: 216,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-1)',
        borderRight: '1px solid var(--line-2)',
      }}
    >
      <div style={{ padding: 'var(--s-3) var(--s-3) var(--s-2)' }}>
        <div className="settings-nav-search">
          <Icon icon={Search} size={13} strokeWidth={1.6} color="var(--fg-3)" />
          <input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Filter settings…"
            aria-label="Filter settings"
            spellCheck={false}
          />
        </div>
      </div>

      <div className="argus-scroll" style={{ flex: 1, overflow: 'auto', padding: '0 var(--s-2) var(--s-4)' }}>
        {/* Pinned above the groups: a cross-pane view, not a pane. Stays while
            open so resetting the last row lands on its empty state. */}
        {(modifiedCount > 0 || active === 'modified') && (
          <button
            role="tab"
            aria-selected={active === 'modified'}
            tabIndex={active === 'modified' ? 0 : -1}
            onClick={() => { setCursorHit(null); onShowModified(); }}
            className={`settings-nav-item${active === 'modified' ? ' is-active' : ''}`}
            style={{ marginTop: 'var(--s-1)' }}
          >
            <Icon icon={ListChecks} size={13} strokeWidth={1.6} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>Modified</span>
            <span style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-3)', fontVariantNumeric: 'tabular-nums' }}>
              {modifiedCount}
            </span>
          </button>
        )}
        {visible.length === 0 && (
          <div style={{ padding: 'var(--s-3) var(--s-2)', fontSize: 'var(--t-xs)', color: 'var(--fg-3)' }}>
            Nothing matches “{query.trim()}”.
          </div>
        )}
        {GROUP_ORDER.map((group) => {
          const panes = byGroup(group);
          if (panes.length === 0) return null;
          return (
            <div key={group}>
              <div className="settings-nav-group">{group}</div>
              {panes.map((p) => {
                const Glyph = p.icon;
                const on = p.id === active;
                return (
                  <div key={p.id}>
                    <button
                      role="tab"
                      aria-selected={on}
                      tabIndex={on ? 0 : -1}
                      onClick={() => { setCursorHit(null); onSelect(p.id); }}
                      className={`settings-nav-item${on ? ' is-active' : ''}`}
                    >
                      <Icon icon={Glyph} size={13} strokeWidth={1.6} style={{ flexShrink: 0 }} />
                      <span style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>{p.label}</span>
                      {modified.has(p.id) && (
                        <span
                          className="settings-nav-dot"
                          title="Holds a value that differs from the default"
                          aria-label="modified"
                        />
                      )}
                    </button>
                    {hitsFor(p.id).map((h) => (
                      <button
                        key={h.setting.id}
                        type="button"
                        tabIndex={-1}
                        className={`settings-nav-hit${cursor === h.setting.id ? ' is-active' : ''}`}
                        onClick={() => { setCursorHit(h.setting.id); onGoTo(h.setting.id); }}
                        title={h.hidden && h.revealVia ? `Turn on ${h.revealVia.label} first` : `${h.setting.section} › ${h.setting.label}`}
                      >
                        <span className="settings-nav-hit-label">{h.setting.label}</span>
                        {h.hidden && h.revealVia && (
                          <span className="settings-nav-hit-note">Turn on {h.revealVia.label} first</span>
                        )}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
