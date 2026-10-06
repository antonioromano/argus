export interface MoveObserver {
  /** Re-arm against the element's current rect; a no-op if it has not moved. */
  refresh(): void;
  disconnect(): void;
}

/**
 * Calls `onMove` when `el` changes position in the viewport, including a pure
 * translation — which fires neither ResizeObserver (the size is unchanged) nor
 * a plain IntersectionObserver (the element stays fully visible). The Mosaic
 * grid does exactly that: going from 3 to 4 tiles moves the third tile from
 * column 3 to column 2 at the same width and height.
 *
 * The trick is floating-ui's `layoutShift` observer: shrink the
 * IntersectionObserver's root, via a negative rootMargin, to exactly the
 * element's current rect. While it stays put its ratio is 1; any move takes
 * part of it outside that root, the ratio drops, the callback fires, and the
 * observer is re-armed at the new position.
 */
export function observeMove(el: Element, onMove: () => void): MoveObserver {
  let io: IntersectionObserver | null = null;
  let armedKey = '';
  let retry: ReturnType<typeof setTimeout> | undefined;

  const disconnect = () => {
    clearTimeout(retry);
    io?.disconnect();
    io = null;
    armedKey = '';
  };

  const arm = (threshold = 1) => {
    disconnect();
    if (typeof IntersectionObserver === 'undefined') return;
    const r = el.getBoundingClientRect();
    // Nothing to track yet (unmounted, display:none, mid-mount); the caller
    // refreshes once the element has a size again.
    if (r.width <= 0 || r.height <= 0) return;
    const root = document.documentElement;
    const top = Math.floor(r.top);
    const left = Math.floor(r.left);
    const right = Math.floor(root.clientWidth - (r.left + r.width));
    const bottom = Math.floor(root.clientHeight - (r.top + r.height));
    armedKey = `${r.left},${r.top},${r.width},${r.height}`;
    let first = true;
    io = new IntersectionObserver((entries) => {
      const ratio = entries[0]?.intersectionRatio ?? 0;
      if (ratio !== threshold) {
        if (!first) {
          onMove();
          arm();
          return;
        }
        // The first delivery is the baseline, not a move. An element partly
        // outside the viewport can never reach ratio 1, so re-arm at what is
        // visible; one wholly outside gets a near-zero threshold, retried
        // later as floating-ui does.
        if (ratio === 0) retry = setTimeout(() => arm(1e-7), 1000);
        else arm(ratio);
        return;
      }
      first = false;
    }, { rootMargin: `${-top}px ${-right}px ${-bottom}px ${-left}px`, threshold });
    io.observe(el);
  };

  arm();
  return {
    refresh() {
      const r = el.getBoundingClientRect();
      if (io && armedKey === `${r.left},${r.top},${r.width},${r.height}`) return;
      arm();
    },
    disconnect,
  };
}
