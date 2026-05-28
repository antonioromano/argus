import { useState, Fragment } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Square, Search, Settings, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { SidebarKey, SessionCounts } from '../types.js';
import { Kbd } from '../../components/primitives/index.js';
import { StatusDot } from '../../components/primitives/index.js';

const COLLAPSE_KEY = 'argus-sidebar-collapsed';

interface SidebarProps {
  active?: SidebarKey;
  counts?: Partial<SessionCounts>;
  onSelect: (key: SidebarKey) => void;
  version?: string;
  ngrokConnected?: boolean;
  /** Group tree rendered under the Sessions item (hidden when the sidebar is collapsed). */
  sessionTree?: ReactNode;
}

interface Item {
  id: SidebarKey;
  icon: LucideIcon;
  label: string;
  count?: number;
  kbd?: string;
  highlight?: boolean;
}

export function Sidebar({ active = 'sessions', counts = {}, onSelect, version, ngrokConnected, sessionTree }: SidebarProps) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  const pilot: Item[] = [
    { id: 'sessions', icon: Square,    label: 'Shells', count: counts.total, highlight: !!counts.waiting },
    { id: 'palette',  icon: Search,    label: 'Command palette', kbd: '⌘K' },
  ];

  const tools: Item[] = [
    { id: 'settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <aside className="argus-sidebar" data-collapsed={collapsed || undefined}>
      <button
        type="button"
        className="argus-sidebar-collapse-btn"
        onClick={toggleCollapsed}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <PanelLeftOpen size={15} strokeWidth={1.6} /> : <PanelLeftClose size={15} strokeWidth={1.6} />}
      </button>

      {!collapsed && <div className="eyebrow" style={{ padding: '0 var(--s-2)', marginBottom: 'var(--s-2)' }}>Pilot</div>}
      {pilot.map((it) => (
        <Fragment key={it.id}>
          <Row item={it} active={active === it.id} collapsed={collapsed} onClick={() => onSelect(it.id)} />
          {it.id === 'sessions' && !collapsed && sessionTree && (
            <div style={{ marginBottom: 'var(--s-2)' }}>{sessionTree}</div>
          )}
        </Fragment>
      ))}

      <div style={{ flex: 1 }} />

      {!collapsed && <div className="eyebrow" style={{ padding: '0 var(--s-2)', margin: 'var(--s-4) 0 var(--s-2)' }}>System</div>}
      {tools.map((it) => (
        <Row key={it.id} item={it} active={active === it.id} collapsed={collapsed} onClick={() => onSelect(it.id)} />
      ))}

      {version && (
        <div
          style={{
            marginTop: 'var(--s-3)',
            padding: 'var(--s-2)',
            background: 'var(--bg-2)',
            border: '1px solid var(--line-2)',
            borderRadius: 'var(--r-2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap: 'var(--s-2)',
          }}
          title={collapsed ? `v${version}` : undefined}
        >
          <StatusDot status={ngrokConnected ? 'running' : 'idle'} size={8} />
          {!collapsed && (
            <span className="eyebrow num" style={{ flex: 1 }}>v{version}</span>
          )}
        </div>
      )}
    </aside>
  );
}

function Row({ item, active, collapsed, onClick }: { item: Item; active: boolean; collapsed: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      className="argus-sidebar-row"
      data-active={active || undefined}
      data-highlight={item.highlight || undefined}
      onClick={onClick}
      title={collapsed ? item.label : undefined}
    >
      <Icon size={13} strokeWidth={1.6} color={item.highlight ? 'var(--accent)' : 'currentColor'} />
      <span className="argus-sidebar-label">{item.label}</span>
      {item.count !== undefined && item.count > 0 && (
        <span className="argus-sidebar-count">{item.count}</span>
      )}
      {item.kbd && (
        <span className="argus-sidebar-kbd">
          <Kbd>{item.kbd}</Kbd>
        </span>
      )}
    </button>
  );
}
