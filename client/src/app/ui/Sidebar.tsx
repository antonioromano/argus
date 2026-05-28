import { useState, Fragment } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Square, Search, Wifi, Settings, Sun, Moon, FolderOpen, GitCompare, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { SidebarKey, SessionCounts } from '../types.js';
import { Kbd } from '../../components/primitives/index.js';
import { StatusDot } from '../../components/primitives/index.js';

const COLLAPSE_KEY = 'argus-sidebar-collapsed';

interface SidebarProps {
  active?: SidebarKey;
  counts?: Partial<SessionCounts>;
  onSelect: (key: SidebarKey) => void;
  isDark: boolean;
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

export function Sidebar({ active = 'sessions', counts = {}, onSelect, isDark, version, ngrokConnected, sessionTree }: SidebarProps) {
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
    { id: 'sessions', icon: Square,    label: 'Sessions', count: counts.total, highlight: !!counts.waiting },
    { id: 'palette',  icon: Search,    label: 'Command palette', kbd: '⌘K' },
  ];

  const tools: Item[] = [
    { id: 'diff',     icon: GitCompare,  label: 'Diff' },
    { id: 'explorer', icon: FolderOpen,  label: 'Files' },
    { id: 'remote',   icon: Wifi,        label: 'Remote', highlight: ngrokConnected },
    { id: 'settings', icon: Settings,    label: 'Settings' },
    { id: 'theme',    icon: isDark ? Sun : Moon, label: isDark ? 'Light mode' : 'Dark mode' },
  ];

  return (
    <aside
      style={{
        width: collapsed ? 56 : 220,
        flexShrink: 0,
        background: 'var(--bg-1)',
        borderRight: '1px solid var(--line-2)',
        display: 'flex',
        flexDirection: 'column',
        padding: 'var(--s-3) var(--s-2)',
        overflowY: 'auto',
        overflowX: 'hidden',
        transition: 'width 180ms var(--ease-std)',
      }}
    >
      <button
        type="button"
        onClick={toggleCollapsed}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        style={{
          all: 'unset',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-end',
          padding: '6px var(--s-2)',
          color: 'var(--fg-2)',
          borderRadius: 'var(--r-2)',
          marginBottom: 'var(--s-2)',
        }}
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
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-micro)', color: 'var(--fg-2)', flex: 1, letterSpacing: 'var(--tracking-eye)' }}>
              v{version}
            </span>
          )}
        </div>
      )}
    </aside>
  );
}

function Row({ item, active, collapsed, onClick }: { item: Item; active: boolean; collapsed: boolean; onClick: () => void }) {
  const Icon = item.icon;
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const color = item.highlight ? 'var(--accent)' : active ? 'var(--fg-0)' : hover ? 'var(--fg-0)' : 'var(--fg-1)';
  const bg = pressed
    ? 'var(--accent-bg)'
    : active
      ? 'var(--bg-3)'
      : hover
        ? 'var(--bg-2)'
        : 'transparent';
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPressed(false); }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'flex-start',
        gap: 'var(--s-2)',
        padding: '6px var(--s-2)',
        background: bg,
        color,
        borderRadius: 'var(--r-2)',
        fontSize: 'var(--t-sm)',
        borderLeft: `2px solid ${active ? 'var(--accent)' : hover ? 'var(--accent-edge)' : 'transparent'}`,
        marginBottom: 1,
        boxSizing: 'border-box',
        transition: 'background var(--dur-fast) var(--ease-std), color var(--dur-fast), border-color var(--dur-fast)',
      }}
    >
      <Icon
        size={13}
        strokeWidth={1.6}
        color={item.highlight ? 'var(--accent)' : 'currentColor'}
      />
      {!collapsed && <span style={{ flex: 1 }}>{item.label}</span>}
      {!collapsed && item.count !== undefined && item.count > 0 && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-micro)',
            color: item.highlight ? 'var(--accent)' : 'var(--fg-3)',
            letterSpacing: 'var(--tracking-eye)',
          }}
        >
          {item.count}
        </span>
      )}
      {!collapsed && item.kbd && <Kbd>{item.kbd}</Kbd>}
    </button>
  );
}
