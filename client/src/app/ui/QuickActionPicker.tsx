import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import type { TileQuickAction } from '@argus/shared';
import { PICKABLE_QUICK_ACTIONS, tileActionMeta } from '../../constants/tileActions.js';
import { SuppressWhileMounted } from '../../hooks/useOverlaySuppression.js';

interface QuickActionPickerProps {
  value: TileQuickAction;
  onChange: (action: TileQuickAction) => void;
  /** Suffixed with " (Default)" in the list and the closed button. */
  defaultAction: TileQuickAction;
}

const CLOSED_W = 210;
const LIST_W = 300;
/** Gap between the button and the list, and the list's margin from the window edge. */
const GAP = 4;
const EDGE = 8;

interface ListPos { left: number; top: number; maxHeight: number }

/**
 * Where the list goes: right-aligned under the button, or above it when the
 * window has more room there (a picker near the bottom of Settings). Fixed
 * coordinates, because the list is portalled to <body> — the settings card's
 * `overflow: hidden` (rounded corners) would otherwise clip it.
 */
function placeList(button: DOMRect, listHeight: number): ListPos {
  const below = window.innerHeight - button.bottom - GAP - EDGE;
  const above = button.top - GAP - EDGE;
  const openUp = listHeight > below && above > below;
  const room = openUp ? above : below;
  const height = Math.min(listHeight, room);
  const left = Math.max(EDGE, Math.min(button.right - LIST_W, window.innerWidth - LIST_W - EDGE));
  return {
    left,
    top: openUp ? button.top - GAP - height : button.bottom + GAP,
    maxHeight: room,
  };
}

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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const current = tileActionMeta(value);
  const CurrentIcon = current.icon;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      // The list lives in a portal, outside wrapRef — clicks on it are inside too.
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !listRef.current?.contains(t)) setOpen(false);
    };
    // Fixed-position list: scrolling the pane or resizing would leave it behind.
    // Close instead of chasing the button (a scroll inside the list itself is fine).
    const onScroll = (e: Event) => {
      if (!listRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onResize = () => setOpen(false);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  // Measure the rendered list, then place it (before paint, so it never flashes
  // at the wrong spot).
  useLayoutEffect(() => {
    if (!open) return;
    const button = buttonRef.current?.getBoundingClientRect();
    const list = listRef.current;
    if (!button || !list) return;
    const pos = placeList(button, list.scrollHeight);
    list.style.left = `${pos.left}px`;
    list.style.top = `${pos.top}px`;
    list.style.maxHeight = `${pos.maxHeight}px`;
    list.style.visibility = 'visible';
  }, [open]);

  const label = (id: TileQuickAction) =>
    `${tileActionMeta(id).label}${id === defaultAction ? ' (Default)' : ''}`;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
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

      {open && createPortal(
        // QuickActionPicker itself stays mounted for the life of the tile
        // header — only `open` toggles the listbox — so SuppressWhileMounted
        // is rendered in this branch to get the listbox's real mount/unmount
        // lifetime rather than the picker's.
        <div
          ref={listRef}
          role="listbox"
          style={{
            // left / top / maxHeight / visibility are set by the layout effect
            // once the list can be measured; hidden until then.
            position: 'fixed',
            left: 0,
            top: 0,
            overflowY: 'auto',
            boxSizing: 'border-box',
            visibility: 'hidden',
            width: LIST_W,
            // Portalled to <body>, so it must clear the Settings sheet (--z-sheet).
            zIndex: 'var(--z-popover)' as unknown as number,
            background: 'var(--bg-2)',
            border: '1px solid var(--line-3)',
            borderRadius: 'var(--r-3)',
            boxShadow: 'var(--shadow-pop)',
            padding: 4,
            animation: 'argus-fade-in var(--dur-fast) var(--ease-out)',
          }}
        >
          <SuppressWhileMounted target={() => listRef.current?.getBoundingClientRect() ?? null} />
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
        </div>,
        document.body,
      )}
    </div>
  );
}
