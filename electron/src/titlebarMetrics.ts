/**
 * Toolbar geometry derived from one number, the toolbar height (plan 008).
 * The traffic lights are placed with trafficLightPosition /
 * setWindowButtonPosition so they sit centred on the toolbar row at every
 * density, and the renderer's left inset (--titlebar-inset) comes from the
 * same function instead of a magic number. Pure, so node:test pins it.
 */

/** Default toolbar height (px): AppKit's regular toolbar. */
export const DEFAULT_TITLEBAR_H = 44;

const BUTTON = 14;    // traffic-light button frame
const GAP = 6;        // between buttons
const LEFT = 16;      // window edge to the close button
const TRAILING = 12;  // after the zoom button, before the title

export interface TrafficLights {
  x: number;
  y: number;
  /** Where toolbar content may start, clear of the three buttons. */
  inset: number;
}

export function trafficLights(titlebarH: number): TrafficLights {
  return {
    x: LEFT,
    y: Math.round((titlebarH - BUTTON) / 2),
    inset: LEFT + 3 * BUTTON + 2 * GAP + TRAILING,
  };
}

/** A renderer-reported toolbar height, or null if it is not a sane one. */
export function clampTitlebarHeight(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const h = Math.round(v);
  return h >= 28 && h <= 80 ? h : null;
}
