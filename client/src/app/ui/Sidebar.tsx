import { useState, useRef, Fragment } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { SquareTerminal, Search, Settings, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { SidebarKey, SessionCounts } from '../types.js';
import { Kbd, StatusDot, Tooltip } from '../../components/primitives/index.js';

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
  stagger?: number;
}

export function Sidebar({ active = 'sessions', counts = {}, onSelect, version, ngrokConnected, sessionTree }: SidebarProps) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });
  const [animating, setAnimating] = useState<'collapsing' | 'expanding' | null>(null);
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      setAnimating(next ? 'collapsing' : 'expanding');
      if (animTimerRef.current) clearTimeout(animTimerRef.current);
      animTimerRef.current = setTimeout(() => setAnimating(null), 420);
      return next;
    });
  };

  const pilot: Item[] = [
    { id: 'sessions', icon: SquareTerminal, label: 'Shells', count: counts.total, highlight: !!counts.waiting },
    { id: 'palette',  icon: Search,    label: 'Command palette', kbd: '⌘K', stagger: 0 },
  ];

  const tools: Item[] = [
    { id: 'settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <aside className="argus-sidebar" data-collapsed={collapsed || undefined} data-animating={animating ?? undefined}>
      <Tooltip content={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        <button
          type="button"
          className="argus-sidebar-collapse-btn"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen size={20} strokeWidth={1.6} /> : <PanelLeftClose size={20} strokeWidth={1.6} />}
        </button>
      </Tooltip>

      <div className="eyebrow" style={{ padding: '0 var(--s-2)', marginBottom: 'var(--s-2)' }}>Pilot</div>
      {pilot.map((it) => (
        <Fragment key={it.id}>
          <Row item={it} active={active === it.id} collapsed={collapsed} onClick={() => onSelect(it.id)} />
          {it.id === 'sessions' && sessionTree && (
            <div className={`argus-sidebar-tree${collapsed ? ' argus-sidebar-tree--collapsed' : ''}`}>
              {sessionTree}
            </div>
          )}
        </Fragment>
      ))}

      <div style={{ flex: 1 }} />

      <div className="eyebrow" style={{ padding: '0 var(--s-2)', margin: 'var(--s-4) 0 var(--s-2)' }}>System</div>
      {tools.map((it) => (
        <Row key={it.id} item={it} active={active === it.id} collapsed={collapsed} onClick={() => onSelect(it.id)} />
      ))}

      {version && (
        (() => {
          const versionBox = (
            <div
              style={{
                marginTop: 'var(--s-3)',
                padding: 'var(--s-2)',
                background: 'var(--bg-2)',
                border: '1px solid var(--line-2)',
                borderRadius: 'var(--r-2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                gap: 'var(--s-2)',
              }}
            >
              <StatusDot status={ngrokConnected ? 'running' : 'idle'} size={8} />
              <span className="eyebrow num argus-sidebar-version-txt" style={{ flex: 1 }}>v{version}</span>
            </div>
          );
          return collapsed ? <Tooltip content={`v${version}`}>{versionBox}</Tooltip> : versionBox;
        })()
      )}
    </aside>
  );
}

function Row({ item, active, collapsed, onClick }: { item: Item; active: boolean; collapsed: boolean; onClick: () => void }) {
  const Icon = item.icon;
  const btn = (
    <button
      type="button"
      className="argus-sidebar-row"
      data-active={active || undefined}
      data-highlight={item.highlight || undefined}
      data-stagger={item.stagger !== undefined ? item.stagger : undefined}
      onClick={onClick}
    >
      <Icon size={20} strokeWidth={1.6} color={item.highlight ? 'var(--accent)' : 'currentColor'} />
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
  return collapsed ? <Tooltip content={item.label}>{btn}</Tooltip> : btn;
}
