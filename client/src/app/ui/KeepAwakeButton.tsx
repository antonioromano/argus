import { useEffect, useRef, useState } from 'react';
import { Coffee, Check, PowerOff } from 'lucide-react';
import type { KeepAwakeStatus } from '@argus/shared';
import { Tooltip, ContextMenu } from '../../components/primitives/index.js';
import type { ContextMenuEntry } from '../../components/primitives/index.js';
import { KEEP_AWAKE_OPTIONS, formatRemaining, remainingMs } from './keepAwakeFormat.js';

interface KeepAwakeButtonProps {
  status: KeepAwakeStatus | null;
  onArm: (durationMs: number | null) => void;
  onDisarm: () => void;
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
  transition: 'background var(--dur-fast) var(--ease-std), color var(--dur-fast)',
  padding: 0,
  ...noDrag,
};

/** Armed: amber pill carrying the countdown — same shape as the update pill. */
const armedPill: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: 28,
  padding: '0 8px 0 7px',
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

/**
 * "Keep this Mac awake" for a chosen window — the Amphetamine gesture.
 *
 * Idle it is a plain 28×28 icon, indistinguishable in weight from the globe and
 * gear beside it. Armed it grows into an amber pill with a live countdown, so the
 * remaining time never costs a hover. The countdown field has a fixed width and
 * tabular figures, so ticking digits cannot jitter the toolbar.
 */
export function KeepAwakeButton({ status, onArm, onDisarm }: KeepAwakeButtonProps) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  // The clock lives in state and is formatted during render: reading Date.now()
  // in the render body is impure (and a lint error). Same shape as ClockDisplay.
  const [now, setNow] = useState(() => Date.now());

  const active = status?.active ?? false;
  const expiresAt = status?.expiresAt ?? null;
  const indefinite = status?.indefinite ?? false;

  // Tick once a second, but only while a finite window is actually armed — an
  // idle toolbar must not hold a live interval. `now` is deliberately NOT seeded
  // here (a synchronous setState in an effect cascades renders): a `now` up to a
  // second stale reports slightly MORE time remaining, and formatRemaining rounds
  // up, so a freshly-armed pill reads the full window and self-corrects on the
  // first tick.
  useEffect(() => {
    if (!active || expiresAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active, expiresAt]);

  const countdown = indefinite ? '∞' : formatRemaining(remainingMs(expiresAt, now));

  const openMenu = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    // ContextMenu clamps itself inside the viewport, so a raw anchor is fine.
    setMenuAt(rect ? { x: rect.left, y: rect.bottom + 6 } : { x: 0, y: 34 });
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
          style={active ? armedPill : idleBtn}
          aria-label={tooltip}
        >
          <Coffee size={13} strokeWidth={1.6} />
          {active && <span style={{ minWidth: 44, textAlign: 'right' }}>{countdown}</span>}
        </button>
      </Tooltip>
      {menuAt && (
        <ContextMenu x={menuAt.x} y={menuAt.y} items={items} onClose={() => setMenuAt(null)} />
      )}
    </>
  );
}
