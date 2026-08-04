import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { TileQuickAction } from '@argus/shared';
import { PICKABLE_QUICK_ACTIONS, tileActionMeta } from '../../constants/tileActions.js';

interface QuickActionPickerProps {
  value: TileQuickAction;
  onChange: (action: TileQuickAction) => void;
  /** Suffixed with " (Default)" in the list and the closed button. */
  defaultAction: TileQuickAction;
}

const CLOSED_W = 210;
const LIST_W = 300;

/**
 * Dropdown for the tile header's pinned action. A native <select> cannot render
 * an icon in an <option>, and the icon is the thing you are actually choosing —
 * it is what ends up in every shell header. This also surfaces each action's
 * one-line hint, which the native control had nowhere to put.
 *
 * Rows change background only on hover — no size change, so the list never
 * reflows under the cursor.
 */
export function QuickActionPicker({ value, onChange, defaultAction }: QuickActionPickerProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const current = tileActionMeta(value);
  const CurrentIcon = current.icon;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const label = (id: TileQuickAction) =>
    `${tileActionMeta(id).label}${id === defaultAction ? ' (Default)' : ''}`;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          all: 'unset',
          boxSizing: 'border-box',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--s-2)',
          minWidth: CLOSED_W,
          height: 32,
          padding: '0 var(--s-2)',
          background: 'var(--bg-1)',
          border: `1px solid ${open ? 'var(--accent-edge)' : 'var(--line-2)'}`,
          borderRadius: 'var(--r-2)',
          color: 'var(--fg-0)',
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--t-sm)',
        }}
      >
        <CurrentIcon size={13} strokeWidth={1.7} style={{ flexShrink: 0, color: 'var(--fg-2)' }} />
        <span style={{ flex: 1, minWidth: 0 }}>{label(value)}</span>
        <ChevronDown size={13} strokeWidth={1.7} style={{ flexShrink: 0, color: 'var(--fg-3)' }} />
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 36,
            right: 0,
            width: LIST_W,
            zIndex: 'var(--z-pop)' as unknown as number,
            background: 'var(--bg-2)',
            border: '1px solid var(--line-3)',
            borderRadius: 'var(--r-3)',
            boxShadow: 'var(--shadow-pop)',
            padding: 4,
            animation: 'argus-fade-in var(--dur-fast) var(--ease-out)',
          }}
        >
          {PICKABLE_QUICK_ACTIONS.map((id) => {
            const meta = tileActionMeta(id);
            const Icon = meta.icon;
            const selected = id === value;
            return (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={selected}
                className="argus-ctx-item"
                onClick={() => { setOpen(false); onChange(id); }}
                style={{
                  all: 'unset',
                  boxSizing: 'border-box',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  width: '100%',
                  padding: '6px var(--s-2)',
                  borderRadius: 'var(--r-2)',
                  cursor: 'pointer',
                  color: selected ? 'var(--accent)' : 'var(--fg-1)',
                }}
              >
                <Icon size={13} strokeWidth={1.7} style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 'var(--t-sm)' }}>{label(id)}</span>
                  <span style={{ display: 'block', fontSize: 'var(--t-micro)', color: 'var(--fg-4)', marginTop: 1 }}>
                    {meta.hint}
                  </span>
                </span>
                <Check
                  size={12}
                  strokeWidth={2}
                  style={{ flexShrink: 0, opacity: selected ? 1 : 0, color: 'var(--accent)' }}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
