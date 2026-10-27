import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ResizeDivider } from '../../components/ResizeDivider.js';
import { clampInspectorWidth, INSPECTOR_WIDTH_DEFAULT } from './inspectorWidth.js';

/**
 * The inspector docked as a right-hand column. Width is a drag on the left
 * edge: tracked locally while dragging, saved once on release (one config
 * write per drag, not per mousemove). Double-click resets it.
 */
export function InspectorColumn({ width, onWidthChange, children }: {
  width: number | undefined;
  /** Persists the width; a rejection drops the optimistic width so the column shows what is stored. */
  onWidthChange: (width: number) => Promise<unknown>;
  children: ReactNode;
}) {
  const stored = clampInspectorWidth(width);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  // The released width, held until the saved config echoes back (the `width`
  // prop changes), so the column doesn't snap back for the round-trip.
  const [pending, setPending] = useState<{ width: number; over: number | undefined } | null>(null);
  const pendingWidth = pending && pending.over === width ? pending.width : null;
  const dragRef = useRef<{ startX: number; startWidth: number; last: number } | null>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: stored, last: stored };
    setDragWidth(stored);
  }, [stored]);

  const dragging = dragWidth !== null;
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      // The column sits right of the divider: dragging left widens it.
      drag.last = clampInspectorWidth(drag.startWidth + (drag.startX - e.clientX));
      setDragWidth(drag.last);
    };
    const onUp = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      setDragWidth(null);
      if (drag && drag.last !== drag.startWidth) {
        setPending({ width: drag.last, over: width });
        onWidthChange(drag.last).catch((err: unknown) => {
          console.error(err);
          setPending(null);
        });
      }
      // Terminals withheld intermediate widths while the column moved.
      setTimeout(() => window.dispatchEvent(new Event('terminal:refit')), 0);
    };
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = prevCursor;
    };
  }, [dragging, onWidthChange, width]);

  return (
    <>
      <ResizeDivider
        isDragging={dragging}
        onMouseDown={onMouseDown}
        onDoubleClick={() => { onWidthChange(INSPECTOR_WIDTH_DEFAULT).catch(console.error); }}
      />
      <aside
        className="argus-inspector-column"
        aria-label="Session inspector"
        style={{ width: dragWidth ?? pendingWidth ?? stored }}
      >
        {children}
      </aside>
    </>
  );
}
