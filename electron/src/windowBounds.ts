/**
 * Where a window reopens (plan 009 W1). Pure: no electron import, so the
 * restore rules are testable without a display server.
 */

export interface Rect { x: number; y: number; width: number; height: number }

export interface DisplayLike { id: number; workArea: Rect }

export interface SavedWindowBounds {
  displayId: number;
  bounds: Rect;
}

export const MIN_WIDTH = 800;
export const MIN_HEIGHT = 600;
export const DEFAULT_WIDTH = 1400;
export const DEFAULT_HEIGHT = 900;
/** How much of the title bar must be on screen for the window to count as reachable. */
export const MIN_VISIBLE = 64;
/** The strip at the top of the window a user grabs to drag it. */
const TITLE_STRIP = 28;

/**
 * True when enough of the window's title bar lies inside the work area to grab
 * it: at least MIN_VISIBLE px across, and the strip's top inside the area
 * vertically. Checks both axes — a window parked below the dock used to pass.
 */
export function isOnDisplay(bounds: Rect, workArea: Rect): boolean {
  const left = Math.max(bounds.x, workArea.x);
  const right = Math.min(bounds.x + bounds.width, workArea.x + workArea.width);
  const across = right - left;
  const topOk = bounds.y >= workArea.y && bounds.y + TITLE_STRIP <= workArea.y + workArea.height;
  return across >= MIN_VISIBLE && topOk;
}

/**
 * The bounds to create a window with. A saved window returns to its display
 * when that display is still connected (else the primary), sized to fit it;
 * its position is kept only if the title bar would be reachable there,
 * otherwise x/y are left out and Electron centres it.
 */
export function resolveInitialBounds(
  saved: SavedWindowBounds | undefined,
  displays: readonly DisplayLike[],
  primary: DisplayLike,
): { x?: number; y?: number; width: number; height: number } {
  if (!saved) return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  const area = (displays.find((d) => d.id === saved.displayId) ?? primary).workArea;
  const width = Math.max(MIN_WIDTH, Math.min(saved.bounds.width, area.width));
  const height = Math.max(MIN_HEIGHT, Math.min(saved.bounds.height, area.height));
  const candidate = { x: saved.bounds.x, y: saved.bounds.y, width, height };
  return isOnDisplay(candidate, area) ? candidate : { width, height };
}

/** Coalesce a burst of calls (resize/move fire per frame) into one, `ms` after the last. */
export function debounce(fn: () => void, ms: number): (() => void) & { flush: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => { timer = null; fn(); };
  const call = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, ms);
  };
  call.flush = () => { if (timer) { clearTimeout(timer); run(); } };
  call.cancel = () => { if (timer) clearTimeout(timer); timer = null; };
  return call;
}
