import { useState, useRef, useEffect, useCallback, Fragment } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { SquareTerminal, Search, Settings, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { SidebarKey, SessionCounts } from '../types.js';
import { Kbd, StatusDot, Tooltip, Icon } from '../../components/primitives/index.js';
import { ResizeDivider } from '../../components/ResizeDivider.js';
import { SIDEBAR_COLLAPSE_KEY as COLLAPSE_KEY, readSidebarCollapsed } from './sidebarState.js';
import { useDensity } from '../../context/density-context.js';

const WIDTH_KEY = 'argus-sidebar-width';

// Expanded width is a dragged, persisted value. The bounds are the useful range
// rather than arbitrary: below the minimum the session tree's nested rows start
// eliding folder names to nothing, and past the maximum the sidebar is taking
// space from the terminals it exists to navigate.
const WIDTH_MIN = 190;
const WIDTH_MAX = 460;
// Until the user drags it, the width is the density's (useDensity().sidebarW:
// Compact is narrower). Builds before density persisted 220 for everyone on
// first launch, so a stored 220 still means "never dragged".
const LEGACY_DEFAULT = 220;

/** The user's dragged width, or null to follow the density. */
function readStoredWidth(): number | null {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    if (!Number.isFinite(n) || n === 0 || n === LEGACY_DEFAULT) return null;
    return Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, n));
  } catch {
    return null;
  }
}
// Collapse/expand is signature motion: its timings live in tokens.css
// (--motion-sidebar-*, --ease-sidebar-*). Inline transitions name the tokens;
// the phase timers read the same tokens so both stay in step.
const COLLAPSE_T = 'var(--motion-sidebar-collapse) var(--ease-sidebar-collapse)';
const EXPAND_T   = 'var(--motion-sidebar-expand) var(--ease-sidebar-expand)';

/** A `--motion-*` token in milliseconds, or `fallback` when it can't be read. */
function motionMs(name: string, fallback: number): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface SidebarProps {
  active?: SidebarKey;
  counts?: Partial<SessionCounts>;
  onSelect: (key: SidebarKey) => void;
  version?: string;
  ngrokConnected?: boolean;
  /** Group tree rendered under the Sessions item (hidden when the sidebar is collapsed). */
  sessionTree?: ReactNode;
  /** Session Inspector (stacked layout): fills the space between Pilot and System. Hidden while collapsed. */
  inspector?: ReactNode;
  /** Getting-started checklist: top of the slot between Pilot and System. Rendered collapsed too (it shows a rail row then). */
  checklist?: ReactNode;
  /** Reports the collapsed state, so the app knows whether `inspector` is actually on screen. */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Bump to expand a collapsed sidebar (e.g. to reveal the inspector it holds). */
  expandRequest?: number;
}

interface Item {
  id: SidebarKey;
  icon: LucideIcon;
  label: string;
  count?: number;
  kbd?: string;
  highlight?: boolean;
}

export function Sidebar({ active = 'sessions', counts = {}, onSelect, version, ngrokConnected, sessionTree, inspector, checklist, onCollapsedChange, expandRequest }: SidebarProps) {
  const [collapsed, setCollapsed] = useState<boolean>(readSidebarCollapsed);
  const [animating, setAnimating] = useState<'collapsing' | 'collapsing-2' | 'expanding' | 'expanding-2' | null>(null);
  const { sidebarW } = useDensity();
  const [customWidth, setWidth] = useState<number | null>(readStoredWidth);
  const width = customWidth ?? sidebarW;
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
    // Reduce motion: no choreography, so no phase timers to wait out.
    if (prefersReducedMotion()) {
      setCollapsed(true);
      try { localStorage.setItem(COLLAPSE_KEY, '1'); } catch { /* ignore */ }
      return;
    }
    const fade = motionMs('--motion-sidebar-fade', 420);
    const shrink = motionMs('--motion-sidebar-collapse', 520);
    setAnimating('collapsing');
    // Phase 1 (0 → fade): CSS fades tree, version-box, labels, eyebrows.

    // Phase 2 (fade): pin heights BEFORE adding class, then transition to 0.
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
        tree.style.transition = `max-height ${COLLAPSE_T}, margin-bottom ${COLLAPSE_T}`;
        tree.style.maxHeight = '0px';
        tree.style.marginBottom = '0px';
      }
      if (vbox) {
        vbox.style.transition = `max-height ${COLLAPSE_T}, margin-top ${COLLAPSE_T}, padding-top ${COLLAPSE_T}, padding-bottom ${COLLAPSE_T}`;
        vbox.style.maxHeight = '0px';
        vbox.style.marginTop = '0px';
        vbox.style.paddingTop = '0px';
        vbox.style.paddingBottom = '0px';
      }
    }, fade));

    // Finalise (fade + shrink): flip collapsed state, clean up.
    timers.current.push(setTimeout(() => {
      if (treeRef.current) treeRef.current.style.cssText = '';
      clearVboxAnim();
      setCollapsed(true);
      try { localStorage.setItem(COLLAPSE_KEY, '1'); } catch { /* ignore */ }
      setAnimating(null);
    }, fade + shrink));
  };

  const doExpand = () => {
    clearTimers();
    if (prefersReducedMotion()) {
      setCollapsed(false);
      try { localStorage.setItem(COLLAPSE_KEY, '0'); } catch { /* ignore */ }
      return;
    }
    const grow = motionMs('--motion-sidebar-expand', 450);
    const fade = motionMs('--motion-sidebar-fade', 420);
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
        tree.style.transition = `max-height ${EXPAND_T}, margin-bottom ${EXPAND_T}`;
        tree.style.maxHeight = tree.scrollHeight + 'px';
        tree.style.marginBottom = '8px'; // var(--s-2)
      }
      if (vbox) {
        vbox.style.borderTopWidth = '1px';
        vbox.style.borderBottomWidth = '1px';
        vbox.style.transition = `max-height ${EXPAND_T}, margin-top ${EXPAND_T}, padding-top ${EXPAND_T}, padding-bottom ${EXPAND_T}`;
        vbox.style.maxHeight = vbox.scrollHeight + 'px';
        vbox.style.marginTop = '12px';  // var(--s-3)
        vbox.style.paddingTop = '8px';  // var(--s-2)
        vbox.style.paddingBottom = '8px';
      }

      // Phase 2 (grow + a 20 ms margin): content fades in.
      timers.current.push(setTimeout(() => {
        setAnimating('expanding-2');
        if (treeRef.current) treeRef.current.style.cssText = '';
        clearVboxAnim();
      }, grow + 20));

      // Finalise (phase 2 + fade).
      timers.current.push(setTimeout(() => {
        setAnimating(null);
      }, grow + 20 + fade));
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
    try {
      if (customWidth === null) localStorage.removeItem(WIDTH_KEY);
      else localStorage.setItem(WIDTH_KEY, String(customWidth));
    } catch { /* ignore */ }
  }, [customWidth]);

  useEffect(() => { onCollapsedChange?.(collapsed); }, [collapsed, onCollapsedChange]);

  // Latest-ref so the expand request below runs the current doExpand closure.
  const expandRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    expandRef.current = () => { if (collapsed && animating === null) doExpand(); };
  });
  useEffect(() => {
    if (expandRequest) expandRef.current?.();
  }, [expandRequest]);

  const pilot: Item[] = [
    { id: 'sessions', icon: SquareTerminal, label: 'Sessions', count: counts.total, highlight: !!counts.waiting },
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
          {collapsed ? <Icon icon={PanelLeftOpen} size="xl" /> : <Icon icon={PanelLeftClose} size="xl" />}
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

      {checklist}
      {inspector && !collapsed
        ? <div className="argus-sidebar-inspector">{inspector}</div>
        : <div style={{ flex: 1 }} />}

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
          onDoubleClick={() => setWidth(null)}
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
  const Glyph = item.icon;
  const btn = (
    <button
      type="button"
      className="argus-sidebar-row"
      data-active={active || undefined}
      data-highlight={item.highlight || undefined}
      onClick={onClick}
    >
      <Icon icon={Glyph} size="xl" color={item.highlight ? 'var(--accent)' : 'currentColor'} />
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
