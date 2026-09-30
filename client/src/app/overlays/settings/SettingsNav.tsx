import { Search } from 'lucide-react';
import { GROUP_ORDER, PANES, paneMatches, type PaneDef, type PaneId } from './registry.js';

interface SettingsNavProps {
  active: PaneId;
  onSelect: (id: PaneId) => void;
  /** Panes holding at least one non-default value — rendered with an amber dot. */
  modified: Set<PaneId>;
  query: string;
  onQuery: (next: string) => void;
}

/**
 * The sidebar: a filter box over fourteen single-topic panes in four groups.
 *
 * The filter matters more here than it would in a six-tab sheet — with this many
 * panes, "which one holds X" is the question, and the keyword lists in the
 * registry answer it without the user learning our taxonomy first.
 */
export function SettingsNav({ active, onSelect, modified, query, onQuery }: SettingsNavProps) {
  const visible = PANES.filter((p) => paneMatches(p, query));

  // Arrow keys walk the visible panes, wrapping — the filtered-out ones are
  // skipped rather than silently selected.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (visible.length === 0) return;
    e.preventDefault();
    const idx = visible.findIndex((p) => p.id === active);
    const next = e.key === 'ArrowDown'
      ? (idx + 1) % visible.length
      : (idx - 1 + visible.length) % visible.length;
    onSelect(visible[next].id);
  };

  const byGroup = (group: PaneDef['group']) => visible.filter((p) => p.group === group);

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
          <Search size={13} strokeWidth={1.6} color="var(--fg-3)" />
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
                const Icon = p.icon;
                const on = p.id === active;
                return (
                  <button
                    key={p.id}
                    role="tab"
                    aria-selected={on}
                    tabIndex={on ? 0 : -1}
                    onClick={() => onSelect(p.id)}
                    className={`settings-nav-item${on ? ' is-active' : ''}`}
                  >
                    <Icon size={13} strokeWidth={1.6} style={{ flexShrink: 0 }} />
                    <span style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>{p.label}</span>
                    {modified.has(p.id) && (
                      <span
                        className="settings-nav-dot"
                        title="Holds a value that differs from the default"
                        aria-label="modified"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
