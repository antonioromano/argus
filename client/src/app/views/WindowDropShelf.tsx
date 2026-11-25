import { useRef } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { AppWindow, SquarePlus } from 'lucide-react';
import { Icon } from '../../components/primitives/index.js';
import { useOverlaySuppression } from '../../hooks/useOverlaySuppression.js';
import { NEW_WINDOW_DROP_ID, windowDropId, type WindowDropTarget } from './windowDrop.js';

/**
 * "Move to" shelf shown across the top of the Mosaic while a tile is dragged:
 * New window first, then one box per other window.
 *
 * It floats over the top of the grid rather than pushing it down. Pushing would
 * resize every terminal on drag start and again on drop, and each resize is a
 * SIGWINCH that makes agents repaint. A native terminal under it is hidden while
 * the shelf is up (a child NSWindow paints above web content).
 */
export function WindowDropShelf({ targets }: { targets: WindowDropTarget[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useOverlaySuppression(() => ref.current?.getBoundingClientRect() ?? null, { live: true, observe: ref });
  return (
    <div className="argus-window-shelf-anchor">
      <div ref={ref} className="argus-window-shelf" role="group" aria-label="Move to window">
        <span className="argus-window-shelf-label" aria-hidden>Move to</span>
        <ShelfTarget id={NEW_WINDOW_DROP_ID} label="New window" icon={SquarePlus} isNew />
        {targets.map((t) => (
          <ShelfTarget
            key={t.id}
            id={windowDropId(t.id)}
            label={t.label}
            icon={AppWindow}
            hint={`${t.sessionCount} session${t.sessionCount === 1 ? '' : 's'}`}
          />
        ))}
      </div>
    </div>
  );
}

function ShelfTarget({ id, label, icon, hint, isNew }: {
  id: string;
  label: string;
  icon: typeof AppWindow;
  hint?: string;
  isNew?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className="argus-window-target"
      data-over={isOver || undefined}
      data-new={isNew || undefined}
      data-testid={id}
    >
      <Icon icon={icon} size="sm" />
      <span className="argus-window-target-label">{label}</span>
      {hint && <span className="argus-window-target-hint">{hint}</span>}
    </div>
  );
}
