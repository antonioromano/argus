/* WCAG 2.1 contrast maths, shared by tokens/contrast.test.ts and the runtime
 * accent clamp (utils/focusAccent.ts). Colors are [r, g, b, a], 0-255 + 0-1. */

export type Rgba = [number, number, number, number];

/** '#rgb', '#rrggbb', 'rgb(…)' or 'rgba(…)'. Throws on anything else. */
export function parseColor(color: string): Rgba {
  const c = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join('') : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const rgb = /^rgba?\(([^)]+)\)$/.exec(c);
  if (rgb) {
    const [r, g, b, a = 1] = rgb[1].split(',').map(Number);
    return [r, g, b, a];
  }
  throw new Error(`unparseable color ${color}`);
}

/** Composite a (possibly translucent) color over an opaque one. */
export function over(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3];
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
}

export function luminance([r, g, b]: Rgba): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
