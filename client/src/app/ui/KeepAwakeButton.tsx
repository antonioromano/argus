import { useEffect, useRef, useState } from 'react';
import { Coffee, Check, PowerOff } from 'lucide-react';
import type { KeepAwakeStatus } from '@argus/shared';
import { Tooltip, ContextMenu, Icon } from '../../components/primitives/index.js';
import type { ContextMenuEntry } from '../../components/primitives/index.js';
import { KEEP_AWAKE_OPTIONS, formatRemaining, remainingMs } from './keepAwakeFormat.js';

interface KeepAwakeButtonProps {
  status: KeepAwakeStatus | null;
  onArm: (durationMs: number | null) => void;
  onDisarm: () => void;
  /** Status-bar size: text-height control, menu opens upward. */
  compact?: boolean;
}

// WebkitAppRegion is Electron-only and absent from React's CSSProperties; the
// cast is what keeps it, and without it the button becomes window-drag surface.
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

/** Identical chrome to the other tray buttons in ElectronToolbar. */
const idleBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  border: '1px solid transparent',
  borderRadius: 'var(--r-2)',
  background: 'transparent',
  color: 'var(--fg-2)',
  cursor: 'pointer',
  transition: 'background var(--dur-fast) var(--ease), color var(--dur-fast)',
  padding: 0,
  ...noDrag,
};

/** Armed: amber pill carrying the countdown — same shape as the update pill. */
const armedPill: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--s-1-5)',
  height: 28,
  padding: '0 var(--s-2) 0 var(--s-2)',
  border: '1px solid var(--accent-edge)',
  borderRadius: 'var(--r-2)',
  background: 'var(--accent-bg)',
  color: 'var(--accent)',
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--t-tiny)',
  fontVariantNumeric: 'tabular-nums',
  ...noDrag,
};

/** Compact (status bar): a text-height control, no fixed hit box, so the bar
 *  stays one line. Armed it only changes colour; the width is the countdown's. */
const compactBtn = (active: boolean): React.CSSProperties => ({
  all: 'unset',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--s-1)',
  height: '100%',
  padding: '0 var(--s-1-5)',
  borderRadius: 'var(--r-1)',
  color: active ? 'var(--accent)' : 'var(--fg-3)',
  cursor: 'pointer',
  fontVariantNumeric: 'tabular-nums',
});

/**
 * "Keep this Mac awake" for a chosen window — the Amphetamine gesture.
 *
 * Idle it is a plain 28×28 icon, indistinguishable in weight from the globe and
 * gear beside it. Armed it grows into an amber pill with a live countdown, so the
 * remaining time never costs a hover. The countdown field has a fixed width and
 * tabular figures, so ticking digits cannot jitter the toolbar.
 *
 * The `key` is load-bearing. The inner component samples the wall clock once in a
 * useState initializer and thereafter only from its own interval — which runs only
 * while a finite window is armed. An idle toolbar therefore leaves that sample
 * frozen at mount, and arming would paint `expiresAt - mountTime`: the window plus
 * the whole app uptime (arm 5m three hours in → "3:05:00", snapping to "5:00" one
 * tick later). Remounting per window re-runs the initializer, so the first paint is
 * right without a setState-in-effect seed and its cascading render.
 */
export function KeepAwakeButton(props: KeepAwakeButtonProps) {
  const windowKey = props.status?.active ? String(props.status.expiresAt ?? 'indefinite') : 'idle';
  return <KeepAwakeButtonInner key={windowKey} {...props} />;
}

function KeepAwakeButtonInner({ status, onArm, onDisarm, compact = false }: KeepAwakeButtonProps) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  // The clock lives in state and is formatted during render: reading Date.now()
  // in the render body is impure (and a lint error). Same shape as ClockDisplay.
  const [now, setNow] = useState(() => Date.now());

  const active = status?.active ?? false;
  const expiresAt = status?.expiresAt ?? null;
  const indefinite = status?.indefinite ?? false;

  // Tick once a second, but only while a finite window is actually armed — an
  // idle toolbar must not hold a live interval. The initializer above is the only
  // other writer of `now`, which is why the wrapper remounts this component per
  // window: see its comment.
  useEffect(() => {
    if (!active || expiresAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active, expiresAt]);

  const countdown = indefinite ? '∞' : formatRemaining(remainingMs(expiresAt, now));

  const openMenu = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    // ContextMenu clamps itself inside the viewport, so a raw anchor is fine.
    // In the status bar the menu opens upward from the bar.
    if (compact) setMenuAt(rect ? { x: rect.left, y: rect.top - 6 } : { x: 0, y: window.innerHeight - 30 });
    else setMenuAt(rect ? { x: rect.left, y: rect.bottom + 6 } : { x: 0, y: 34 });
  };

  const header = active
    ? indefinite ? 'Keep awake · on' : `Keep awake · ${countdown} left`
    : 'Keep awake';

  const items: ContextMenuEntry[] = [
    { header },
    ...KEEP_AWAKE_OPTIONS.map((o) => ({
      id: `keep-awake-${o.hint}`,
      label: o.label,
      shortcut: o.hint,
      // Only the indefinite row can be checked: KeepAwakeStatus carries expiresAt,
      // not the duration originally chosen, and reverse-deriving "which row did you
      // press" from a ticking expiresAt would be wrong a second later. A finite
      // window's remaining time is already in the header.
      icon: active && o.durationMs === null && indefinite ? Check : undefined,
      onClick: () => onArm(o.durationMs),
    })),
    ...(active
      ? ([
          { separator: true },
          { id: 'keep-awake-off', label: 'Turn off', icon: PowerOff, danger: true, onClick: onDisarm },
        ] as ContextMenuEntry[])
      : []),
  ];

  const tooltip = active
    ? indefinite ? 'Keeping Mac awake' : `Keeping Mac awake — ${countdown} left`
    : 'Keep Mac awake';

  return (
    <>
      <Tooltip content={tooltip}>
        <button
          ref={btnRef}
          onClick={openMenu}
          style={compact ? compactBtn(active) : active ? armedPill : idleBtn}
          aria-label={tooltip}
          data-compact={compact || undefined}
        >
          <Icon icon={Coffee} size={compact ? 11 : 13} />
          {compact
            ? active && <span>Awake {countdown}</span>
            : active && <span style={{ minWidth: 44, textAlign: 'right' }}>{countdown}</span>}
        </button>
      </Tooltip>
      {menuAt && (
        <ContextMenu
          x={menuAt.x}
          y={menuAt.y}
          items={items}
          onClose={() => setMenuAt(null)}
          placement={compact ? 'above' : 'below'}
        />
      )}
    </>
  );
}
