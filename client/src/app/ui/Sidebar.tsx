import { useState, useRef, useEffect, useCallback, Fragment } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { SquareTerminal, Search, Settings, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { SidebarKey, SessionCounts } from '../types.js';
import { Kbd, StatusDot, Tooltip } from '../../components/primitives/index.js';
import { ResizeDivider } from '../../components/ResizeDivider.js';

const COLLAPSE_KEY = 'argus-sidebar-collapsed';
const WIDTH_KEY = 'argus-sidebar-width';

// Expanded width is a dragged, persisted value. The bounds are the useful range
// rather than arbitrary: below the minimum the session tree's nested rows start
// eliding folder names to nothing, and past the maximum the sidebar is taking
// space from the terminals it exists to navigate.
const WIDTH_MIN = 190;
const WIDTH_MAX = 460;
const WIDTH_DEFAULT = 220;

function readStoredWidth(): number {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    if (!Number.isFinite(n) || n === 0) return WIDTH_DEFAULT;
    return Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, n));
  } catch {
    return WIDTH_DEFAULT;
  }
}
const EASE_IN  = 'cubic-bezier(.4,0,1,1)';   // expand: slow start so icons visibly travel
const EASE_IO  = 'cubic-bezier(.4,0,.6,1)';   // collapse: symmetric, not too snappy

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
  const [animating, setAnimating] = useState<'collapsing' | 'collapsing-2' | 'expanding' | 'expanding-2' | null>(null);
  const [width, setWidth] = useState<number>(readStoredWidth);
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const treeRef  = useRef<HTMLDivElement>(null);
  const vboxRef  = useRef<HTMLDivElement>(null);
  const timers   = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  // Clear only the animation-owned inline styles; leaves React-set styles (padding, background…) intact.
  const clearVboxAnim = () => {
    const vbox = vboxRef.current;
    if (!vbox) return;
    vbox.style.maxHeight = '';
    vbox.style.marginTop = '';
    vbox.style.paddingTop = '';
    vbox.style.paddingBottom = '';
    vbox.style.borderTopWidth = '';
    vbox.style.borderBottomWidth = '';
    vbox.style.transition = '';
  };

  const doCollapse = () => {
    clearTimers();
    setAnimating('collapsing');
    // Phase 1 (0–420ms): CSS fades tree, version-box, labels, eyebrows.

    // Phase 2 (420ms): pin heights BEFORE adding class, then transition to 0.
    // Pinning prevents content-height growth from sidebar width-shrink causing cmd palette to jump.
    timers.current.push(setTimeout(() => {
      setAnimating('collapsing-2');
      const tree = treeRef.current;
      const vbox = vboxRef.current;

      if (tree) {
        tree.style.transition = 'none';
        tree.style.maxHeight = tree.getBoundingClientRect().height + 'px';
        tree.style.marginBottom = getComputedStyle(tree).marginBottom;
      }
      if (vbox) {
        const cs = getComputedStyle(vbox);
        vbox.style.transition = 'none';
        vbox.style.maxHeight = vbox.getBoundingClientRect().height + 'px';
        vbox.style.marginTop = cs.marginTop;
        vbox.style.paddingTop = cs.paddingTop;
        vbox.style.paddingBottom = cs.paddingBottom;
        vbox.style.borderTopWidth = '0px';
        vbox.style.borderBottomWidth = '0px';
      }

      void tree?.offsetHeight; // flush

      if (tree) {
        tree.style.transition = `max-height 520ms ${EASE_IO}, margin-bottom 520ms ${EASE_IO}`;
        tree.style.maxHeight = '0px';
        tree.style.marginBottom = '0px';
      }
      if (vbox) {
        vbox.style.transition = `max-height 520ms ${EASE_IO}, margin-top 520ms ${EASE_IO}, padding-top 520ms ${EASE_IO}, padding-bottom 520ms ${EASE_IO}`;
        vbox.style.maxHeight = '0px';
        vbox.style.marginTop = '0px';
        vbox.style.paddingTop = '0px';
        vbox.style.paddingBottom = '0px';
      }
    }, 420));

    // Finalise (940ms): flip collapsed state, clean up.
    timers.current.push(setTimeout(() => {
      if (treeRef.current) treeRef.current.style.cssText = '';
      clearVboxAnim();
      setCollapsed(true);
      try { localStorage.setItem(COLLAPSE_KEY, '1'); } catch { /* ignore */ }
      setAnimating(null);
    }, 940));
  };

  const doExpand = () => {
    clearTimers();
    const tree = treeRef.current;
    const vbox = vboxRef.current;

    // Pin both at 0 BEFORE state change so browser never renders the CSS-default heights.
    if (tree) {
      tree.style.transition = 'none';
      tree.style.maxHeight = '0px';
      tree.style.marginBottom = '0px';
    }
    if (vbox) {
      vbox.style.transition = 'none';
      vbox.style.maxHeight = '0px';
      vbox.style.marginTop = '0px';
      vbox.style.paddingTop = '0px';
      vbox.style.paddingBottom = '0px';
      vbox.style.borderTopWidth = '0px';
      vbox.style.borderBottomWidth = '0px';
    }

    setCollapsed(false);
    try { localStorage.setItem(COLLAPSE_KEY, '0'); } catch { /* ignore */ }
    setAnimating('expanding');

    // setTimeout(0): let browser paint the pinned-at-0 state, then start transitions.
    timers.current.push(setTimeout(() => {
      if (tree) {
        tree.style.transition = `max-height 450ms ${EASE_IN}, margin-bottom 450ms ${EASE_IN}`;
        tree.style.maxHeight = tree.scrollHeight + 'px';
        tree.style.marginBottom = '8px'; // var(--s-2)
      }
      if (vbox) {
        vbox.style.borderTopWidth = '1px';
        vbox.style.borderBottomWidth = '1px';
        vbox.style.transition = `max-height 450ms ${EASE_IN}, margin-top 450ms ${EASE_IN}, padding-top 450ms ${EASE_IN}, padding-bottom 450ms ${EASE_IN}`;
        vbox.style.maxHeight = vbox.scrollHeight + 'px';
        vbox.style.marginTop = '12px';  // var(--s-3)
        vbox.style.paddingTop = '8px';  // var(--s-2)
        vbox.style.paddingBottom = '8px';
      }

      // Phase 2 (470ms): content fades in.
      timers.current.push(setTimeout(() => {
        setAnimating('expanding-2');
        if (treeRef.current) treeRef.current.style.cssText = '';
        clearVboxAnim();
      }, 470));

      // Finalise (890ms).
      timers.current.push(setTimeout(() => {
        setAnimating(null);
      }, 890));
    }, 0));
  };

  const toggleCollapsed = () => {
    if (animating !== null) return;
    if (collapsed) doExpand();
    else doCollapse();
  };

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: width };
    setResizing(true);
  }, [width]);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      // Left-hand rail: dragging right widens it.
      const next = drag.startWidth + (e.clientX - drag.startX);
      setWidth(Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, next)));
    };
    const onUp = () => { setResizing(false); dragRef.current = null; };
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = prevCursor;
    };
  }, [resizing]);

  useEffect(() => {
    try { localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* ignore */ }
  }, [width]);

  const pilot: Item[] = [
    { id: 'sessions', icon: SquareTerminal, label: 'Shells', count: counts.total, highlight: !!counts.waiting },
    { id: 'palette',  icon: Search,         label: 'Find & Jump', kbd: '⌘K' },
  ];

  const tools: Item[] = [
    { id: 'settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <aside
      className="argus-sidebar"
      data-collapsed={collapsed || undefined}
      data-animating={animating ?? undefined}
      // Collapsed width stays in CSS, so leaving it unset here lets the
      // collapse/expand transition run exactly as before. Dragging suppresses
      // that same transition, or every mousemove would animate 180ms behind the
      // cursor.
      style={collapsed ? undefined : { width, transition: resizing ? 'none' : undefined }}
    >
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
            <div
              ref={treeRef}
              className={`argus-sidebar-tree${(collapsed && !animating) ? ' argus-sidebar-tree--collapsed' : ''}`}
            >
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
        // Outer div is always stable so vboxRef never goes null during animation.
        // Tooltip is placed inside (on the dot) so hover-hint still works when collapsed.
        <div
          ref={vboxRef}
          className="argus-sidebar-version-box"
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
            overflow: 'hidden',
          }}
        >
          <Tooltip content={`v${version}`}>
            <StatusDot status={ngrokConnected ? 'running' : 'idle'} size={8} />
          </Tooltip>
          <span className="eyebrow num argus-sidebar-version-txt" style={{ flex: 1 }}>v{version}</span>
        </div>
      )}

      {/* Drag handle. Absolutely positioned on the right edge rather than added
          as a flex sibling in ArgusApp, so the app shell's layout is untouched
          and the handle disappears with the sidebar when it collapses. */}
      {!collapsed && (
        <div
          onDoubleClick={() => setWidth(WIDTH_DEFAULT)}
          title="Drag to resize · double-click to reset"
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'flex-end',
            zIndex: 1,
          }}
        >
          <ResizeDivider isDragging={resizing} onMouseDown={onResizeStart} />
        </div>
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
