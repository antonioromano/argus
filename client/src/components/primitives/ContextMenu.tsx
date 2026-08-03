import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export type ContextMenuEntry = ContextMenuItem | { separator: true } | { header: string };

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}

function isSeparator(entry: ContextMenuEntry): entry is { separator: true } {
  return 'separator' in entry;
}

function isHeader(entry: ContextMenuEntry): entry is { header: string } {
  return 'header' in entry;
}

const MENU_W = 200;

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Clamp inside the viewport once the real height is known.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = Math.min(x, window.innerWidth - rect.width - 8);
    const ny = Math.min(y, window.innerHeight - rect.height - 8);
    setPos({ x: Math.max(8, nx), y: Math.max(8, ny) });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    // capture phase so a single right-click elsewhere closes then re-opens cleanly
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex: 'var(--z-pop)' as unknown as number,
        minWidth: MENU_W,
        background: 'var(--bg-2)',
        border: '1px solid var(--line-3)',
        borderRadius: 'var(--r-3)',
        boxShadow: 'var(--shadow-pop)',
        padding: 4,
        animation: 'argus-fade-in var(--dur-fast) var(--ease-out)',
      }}
    >
      {items.map((entry, i) => {
        if (isSeparator(entry)) {
          return <div key={`sep-${i}`} style={{ height: 1, background: 'var(--line-2)', margin: '4px 6px' }} />;
        }
        if (isHeader(entry)) {
          return (
            <div
              key={`hdr-${i}`}
              className="eyebrow"
              style={{ padding: '6px 9px 3px', color: 'var(--fg-4)' }}
            >
              {entry.header}
            </div>
          );
        }
        const Icon = entry.icon;
        return (
          <button
            key={entry.id}
            role="menuitem"
            disabled={entry.disabled}
            onClick={() => {
              if (entry.disabled) return;
              onClose();
              entry.onClick();
            }}
            className="argus-ctx-item"
            data-danger={entry.danger ? '' : undefined}
            style={{
              all: 'unset',
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              width: '100%',
              padding: '6px 9px',
              borderRadius: 'var(--r-2)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-tiny)',
              color: entry.disabled ? 'var(--fg-4)' : 'var(--fg-1)',
              cursor: entry.disabled ? 'default' : 'pointer',
            }}
          >
            {Icon && <Icon size={13} strokeWidth={1.6} style={{ flexShrink: 0 }} />}
            <span style={{ flex: 1, whiteSpace: 'nowrap' }}>{entry.label}</span>
            {entry.shortcut && (
              <span style={{ marginLeft: 'auto', color: 'var(--fg-3)' }}>{entry.shortcut}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
