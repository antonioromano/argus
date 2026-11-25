/* Color themes beyond Argus's own (Settings → Theme & layout → Color theme).
 *
 * Each theme is written down as its ORIGINAL colors and turned into the full
 * Argus token set by `deriveTokens`. Where an original color cannot meet the
 * app's contrast contract (tokens.css header; enforced by contrast.test.ts) on
 * Argus's surfaces, `fit` moves it toward the foreground a step at a time until
 * it does. So a theme can look slightly crisper than its source, never less
 * readable than Argus itself.
 *
 * The same derived values feed both the CSS (one generated stylesheet keyed on
 * <html data-palette>, see paletteStylesheet) and the canvas-painted surfaces
 * (xterm, the native terminal, Monaco) through tokens/paint.ts.
 *
 * Credits — palettes adapted from: One Dark / One Light (Atom, MIT),
 * GitHub Primer (MIT), Catppuccin (MIT), Solarized (Ethan Schoonover, MIT),
 * Darcula / IntelliJ Light (JetBrains IntelliJ Community, Apache-2.0).
 */
import { contrastRatio, over, parseColor, type Rgba } from './contrast.js';

export type Mode = 'dark' | 'light';
export type PaletteId = 'argus' | 'one' | 'github' | 'catppuccin' | 'solarized' | 'jetbrains';

/** A theme's own colors, before any contrast fitting. */
interface Source {
  bg: [page: string, panel: string, card: string, raised: string];
  inset: string;
  fg: [primary: string, body: string, secondary: string, muted: string, decorative: string];
  accent: string;
  red: string; orange: string; yellow: string; green: string; cyan: string; blue: string; purple: string;
  /** Terminal magenta when it differs from `purple`. */
  magenta?: string;
  /** Waiting cue; defaults to `yellow`. */
  waiting?: string;
  syn: { kw: string; str: string; num: string; fn: string; cm: string; pn: string };
}

interface PaletteDef {
  label: string;
  /** Names shown for each half of the pair. */
  names: Record<Mode, string>;
  dark: Source;
  light: Source;
}

const DEFS: Record<Exclude<PaletteId, 'argus'>, PaletteDef> = {
  one: {
    label: 'One', names: { dark: 'One Dark', light: 'One Light' },
    dark: {
      bg: ['#1e2227', '#21252b', '#282c34', '#2c313a'], inset: '#1b1e23',
      fg: ['#e6e9ef', '#abb2bf', '#9da5b4', '#7f848e', '#5c6370'],
      accent: '#61afef',
      red: '#e06c75', orange: '#d19a66', yellow: '#e5c07b', green: '#98c379', cyan: '#56b6c2', blue: '#61afef', purple: '#c678dd',
      syn: { kw: '#c678dd', str: '#98c379', num: '#d19a66', fn: '#61afef', cm: '#7f848e', pn: '#abb2bf' },
    },
    light: {
      bg: ['#e5e5e6', '#eaeaeb', '#fafafa', '#f0f0f1'], inset: '#f0f0f1',
      fg: ['#232324', '#383a42', '#4f525d', '#696c77', '#a0a1a7'],
      accent: '#4078f2',
      red: '#e45649', orange: '#986801', yellow: '#c18401', green: '#50a14f', cyan: '#0184bc', blue: '#4078f2', purple: '#a626a4',
      syn: { kw: '#a626a4', str: '#50a14f', num: '#986801', fn: '#4078f2', cm: '#a0a1a7', pn: '#383a42' },
    },
  },
  github: {
    label: 'GitHub', names: { dark: 'GitHub Dark', light: 'GitHub Light' },
    dark: {
      bg: ['#010409', '#0d1117', '#161b22', '#21262d'], inset: '#0d1117',
      fg: ['#f0f6fc', '#e6edf3', '#c9d1d9', '#8b949e', '#6e7681'],
      accent: '#58a6ff',
      red: '#ff7b72', orange: '#ffa657', yellow: '#d29922', green: '#3fb950', cyan: '#39c5cf', blue: '#58a6ff', purple: '#d2a8ff', magenta: '#bc8cff',
      syn: { kw: '#ff7b72', str: '#a5d6ff', num: '#79c0ff', fn: '#d2a8ff', cm: '#8b949e', pn: '#c9d1d9' },
    },
    light: {
      bg: ['#eff2f5', '#f6f8fa', '#ffffff', '#eaeef2'], inset: '#f6f8fa',
      fg: ['#1f2328', '#24292f', '#424a53', '#59636e', '#8c959f'],
      accent: '#0969da',
      red: '#cf222e', orange: '#bc4c00', yellow: '#9a6700', green: '#1a7f37', cyan: '#1b7c83', blue: '#0969da', purple: '#8250df',
      syn: { kw: '#cf222e', str: '#0a3069', num: '#0550ae', fn: '#8250df', cm: '#6e7781', pn: '#24292f' },
    },
  },
  catppuccin: {
    label: 'Catppuccin', names: { dark: 'Catppuccin Mocha', light: 'Catppuccin Latte' },
    dark: {
      bg: ['#11111b', '#181825', '#1e1e2e', '#313244'], inset: '#181825',
      fg: ['#cdd6f4', '#bac2de', '#a6adc8', '#9399b2', '#6c7086'],
      accent: '#cba6f7',
      red: '#f38ba8', orange: '#fab387', yellow: '#f9e2af', green: '#a6e3a1', cyan: '#94e2d5', blue: '#89b4fa', purple: '#cba6f7', magenta: '#f5c2e7',
      syn: { kw: '#cba6f7', str: '#a6e3a1', num: '#fab387', fn: '#89b4fa', cm: '#9399b2', pn: '#bac2de' },
    },
    light: {
      bg: ['#dce0e8', '#e6e9ef', '#eff1f5', '#ccd0da'], inset: '#e6e9ef',
      fg: ['#4c4f69', '#4c4f69', '#5c5f77', '#6c6f85', '#9ca0b0'],
      accent: '#8839ef',
      red: '#d20f39', orange: '#fe640b', yellow: '#df8e1d', green: '#40a02b', cyan: '#179299', blue: '#1e66f5', purple: '#8839ef', magenta: '#ea76cb',
      syn: { kw: '#8839ef', str: '#40a02b', num: '#fe640b', fn: '#1e66f5', cm: '#7c7f93', pn: '#5c5f77' },
    },
  },
  solarized: {
    label: 'Solarized', names: { dark: 'Solarized Dark', light: 'Solarized Light' },
    dark: {
      bg: ['#001e26', '#00252f', '#002b36', '#073642'], inset: '#00212b',
      fg: ['#eee8d5', '#93a1a1', '#839496', '#839496', '#586e75'],
      accent: '#268bd2',
      red: '#dc322f', orange: '#cb4b16', yellow: '#b58900', green: '#859900', cyan: '#2aa198', blue: '#268bd2', purple: '#6c71c4', magenta: '#d33682',
      syn: { kw: '#859900', str: '#2aa198', num: '#d33682', fn: '#268bd2', cm: '#586e75', pn: '#839496' },
    },
    light: {
      bg: ['#eee8d5', '#f5efdc', '#fdf6e3', '#e6dfc8'], inset: '#eee8d5',
      fg: ['#073642', '#586e75', '#657b83', '#657b83', '#93a1a1'],
      accent: '#268bd2',
      red: '#dc322f', orange: '#cb4b16', yellow: '#b58900', green: '#859900', cyan: '#2aa198', blue: '#268bd2', purple: '#6c71c4', magenta: '#d33682',
      syn: { kw: '#859900', str: '#2aa198', num: '#d33682', fn: '#268bd2', cm: '#93a1a1', pn: '#657b83' },
    },
  },
  jetbrains: {
    label: 'Darcula / IntelliJ', names: { dark: 'Darcula', light: 'IntelliJ Light' },
    dark: {
      bg: ['#252526', '#3c3f41', '#2b2b2b', '#4b4f52'], inset: '#313335',
      fg: ['#e6e6e6', '#a9b7c6', '#bbbbbb', '#8c8c8c', '#6e6e6e'],
      accent: '#589df6',
      // Terminal greens/yellows from the Darcula console scheme; the orange
      // keywords sit too close to amber for Waiting, so Waiting is the gold.
      red: '#ff6b68', orange: '#cc7832', yellow: '#d6bf55', green: '#a8c023', cyan: '#299999', blue: '#5394ec', purple: '#ae8abe',
      waiting: '#ffc66d',
      syn: { kw: '#cc7832', str: '#6a8759', num: '#6897bb', fn: '#ffc66d', cm: '#808080', pn: '#a9b7c6' },
    },
    light: {
      bg: ['#ebecf0', '#f7f8fa', '#ffffff', '#dfe1e5'], inset: '#f7f8fa',
      fg: ['#000000', '#080808', '#383838', '#6e6e6e', '#8c8c8c'],
      accent: '#3574f0',
      red: '#c7222d', orange: '#b25d00', yellow: '#9e6a03', green: '#067d17', cyan: '#00627a', blue: '#0033b3', purple: '#871094',
      syn: { kw: '#0033b3', str: '#067d17', num: '#1750eb', fn: '#00627a', cm: '#8c8c8c', pn: '#080808' },
    },
  },
};

export const PALETTE_IDS: readonly PaletteId[] = ['argus', 'one', 'github', 'catppuccin', 'solarized', 'jetbrains'];

export function isPaletteId(v: unknown): v is PaletteId {
  return typeof v === 'string' && (PALETTE_IDS as readonly string[]).includes(v);
}

export function paletteLabel(id: PaletteId): string {
  return id === 'argus' ? 'Argus' : DEFS[id].label;
}

export function paletteModeName(id: PaletteId, mode: Mode): string {
  return id === 'argus' ? `Argus ${mode === 'dark' ? 'Dark' : 'Light'}` : DEFS[id].names[mode];
}

// ─── Color maths ─────────────────────────────────────────────────────────────

const TEXT = 4.5;
const UI = 3;

const toHex = ([r, g, b]: Rgba) =>
  `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;

/** `a` blended toward `b` by `t` (0 = a, 1 = b), as #rrggbb. */
function mix(a: string, b: string, t: number): string {
  const x = parseColor(a);
  const y = parseColor(b);
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t, 1]);
}

function rgba(color: string, alpha: number): string {
  const [r, g, b] = parseColor(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const surf = (c: string): Rgba => parseColor(c);
const tint = (color: string, alpha: number, on: string): Rgba => over(parseColor(rgba(color, alpha)), parseColor(on));

/** Worst contrast of `fg` over every surface. */
function worst(fg: string, surfaces: Rgba[]): number {
  const f = parseColor(fg);
  return Math.min(...surfaces.map((s) => contrastRatio(f, s)));
}

/**
 * Move `color` toward `target` (white on dark, black on light) in small steps
 * until it clears `min` on every surface. Returns the original untouched when
 * it already passes. The small margin keeps rounding from landing on 4.49.
 */
function fit(color: string, surfaces: Rgba[] | ((candidate: string) => Rgba[]), min: number, target: string): string {
  const on = typeof surfaces === 'function' ? surfaces : () => surfaces;
  if (worst(color, on(color)) >= min + 0.05) return color;
  for (let t = 0.02; t <= 1; t += 0.02) {
    const c = mix(color, target, t);
    if (worst(c, on(c)) >= min + 0.05) return c;
  }
  return target;
}

// ─── Derivation ──────────────────────────────────────────────────────────────

/** Every CSS custom property a non-Argus theme sets, plus the terminal palette. */
export interface DerivedTheme {
  vars: Record<string, string>;
  /** --material-* tints, for a translucent window only. */
  materials: Record<string, string>;
  terminal: TerminalPalette;
  search: { matchBackground: string; matchOverviewRuler: string; activeMatchBackground: string; activeMatchColorOverviewRuler: string };
}

export interface TerminalPalette {
  background: string; foreground: string; cursor: string; selectionBackground: string;
  black: string; red: string; green: string; yellow: string; blue: string; magenta: string; cyan: string; white: string;
  brightBlack: string; brightRed: string; brightGreen: string; brightYellow: string;
  brightBlue: string; brightMagenta: string; brightCyan: string; brightWhite: string;
}

const TINT = { dark: 0.12, light: 0.1 } as const;

function deriveTokens(s: Source, mode: Mode): DerivedTheme {
  const dark = mode === 'dark';
  const toward = dark ? '#ffffff' : '#000000';
  const [bg0, bg1, bg2, bg3] = s.bg;
  const a = TINT[mode];

  // Diff rows: a light wash of the theme's green/red over the card.
  const diffAdd = mix(bg2, s.green, dark ? 0.16 : 0.14);
  const diffDel = mix(bg2, s.red, dark ? 0.16 : 0.12);
  const infoBg = rgba(s.blue, dark ? 0.1 : 0.08);

  const base = [bg0, bg1, bg2, bg3, s.inset].map(surf);
  const text = [...base, surf(diffAdd), surf(diffDel), tint(s.blue, dark ? 0.1 : 0.08, s.inset)];
  // Text that also sits on its own tinted chip.
  // (the chip's tint is made from the candidate itself, at the weakest alpha used).
  const chip = (c: string) => [...text, ...[bg1, bg2, bg3].map((b) => tint(c, a, b))];
  const fitText = (c: string) => fit(c, chip, TEXT, toward);

  const fg = s.fg.slice(0, 4).map((c) => fit(c, text, TEXT, toward));
  const fg4 = fit(s.fg[4], base, UI, toward);
  const accent = fitText(s.accent);
  const waiting = fitText(s.waiting ?? s.yellow);
  const running = fitText(s.green);
  const done = fitText(s.cyan);
  const idle = fitText(s.fg[3]);
  const exited = fitText(mix(s.orange, s.fg[3], 0.45));
  const danger = fitText(s.red);
  const warn = fitText(s.yellow);
  const info = fitText(s.blue);
  const ok = fitText(s.green);
  const dirty = fitText(s.orange);
  const purple = fitText(s.purple);

  // Filled controls: whichever of the page color / white reads best on every fill.
  const onFill = (fills: string[]) =>
    [bg0, '#ffffff', '#000000'].map((c) => ({ c, r: worst(c, fills.map(surf)) })).sort((x, y) => y.r - x.r)[0].c;

  const syn = Object.fromEntries(
    Object.entries(s.syn).map(([k, v]) => [k, fit(v, text, TEXT, toward)]),
  ) as Source['syn'];

  // Form-control edge: the hairline color at the lowest alpha that reaches 3:1
  // on every surface a control sits on.
  const edgeBase = dark ? '#ffffff' : '#140f08';
  let lineControl = rgba(edgeBase, 0.6);
  for (let al = 0.3; al <= 0.6; al += 0.02) {
    const c = rgba(edgeBase, Math.round(al * 100) / 100);
    if ([bg1, bg2, bg3].every((b) => contrastRatio(tint(edgeBase, Math.round(al * 100) / 100, b), surf(b)) >= UI + 0.05)) { lineControl = c; break; }
  }

  const vars: Record<string, string> = {
    '--line-control': lineControl,
    '--bg-0': bg0, '--bg-1': bg1, '--bg-2': bg2, '--bg-3': bg3, '--bg-inset': s.inset,
    '--bg-overlay': rgba(dark ? bg0 : '#14120e', dark ? 0.72 : 0.5),
    '--fg-0': fg[0], '--fg-1': fg[1], '--fg-2': fg[2], '--fg-3': fg[3], '--fg-4': fg4,
    '--fg-on-accent': onFill([accent, waiting, done]),
    '--fg-on-danger': onFill([danger]),
    '--accent': accent,
    '--accent-hi': mix(accent, toward, 0.15),
    '--accent-lo': mix(accent, dark ? '#000000' : '#ffffff', 0.12),
    '--accent-edge': rgba(accent, 0.35),
    '--accent-glow': rgba(accent, 0.18),
    '--accent-bg': rgba(accent, dark ? 0.1 : 0.08),
    '--status-waiting': waiting, '--status-waiting-bg': rgba(waiting, a),
    '--status-running': running, '--status-running-bg': rgba(running, a),
    '--status-idle': idle, '--status-idle-bg': rgba(idle, a * 0.8),
    '--status-done': done, '--status-done-bg': rgba(done, a),
    '--status-exited': exited, '--status-exited-bg': rgba(exited, a * 0.8),
    '--danger': danger, '--danger-bg': rgba(danger, a),
    '--warn': warn, '--warn-bg': rgba(warn, a),
    '--info': info, '--info-bg': infoBg,
    '--ok': ok,
    '--dirty': dirty, '--dirty-bg': rgba(dirty, a),
    '--diff-add': diffAdd,
    '--diff-add-tok': fit(s.green, [surf(diffAdd), surf(bg2)], UI, toward),
    '--diff-del': diffDel,
    '--diff-del-tok': fit(s.red, [surf(diffDel), surf(bg2)], UI, toward),
    '--diff-add-fg': fit(s.green, [surf(diffAdd)], TEXT, toward),
    '--diff-del-fg': fit(s.red, [surf(diffDel)], TEXT, toward),
    '--agent-claude': dirty,
    '--agent-gemini': info,
    '--agent-codex': purple,
    '--pr-merged': purple,
    '--pr-pending': info,
    '--syn-kw': syn.kw, '--syn-str': syn.str, '--syn-num': syn.num,
    '--syn-fn': syn.fn, '--syn-cm': syn.cm, '--syn-pn': syn.pn,
  };
  // Tints over the native vibrancy; only applied while the window is translucent
  // (a solid window keeps tokens.css's opaque var(--bg-*) fallback).
  const materials: Record<string, string> = {
    '--material-sidebar': rgba(bg1, 0.6),
    '--material-toolbar': rgba(bg1, 0.6),
    '--material-sheet': rgba(bg2, 0.82),
    '--material-popover': rgba(bg2, 0.82),
    '--material-menu': rgba(bg2, 0.82),
  };

  // Terminal: every slot readable on the card it is painted on (dark `black`
  // is a background slot for TUIs, so it is left as the page color).
  const termBg = [surf(bg2)];
  const t = (c: string) => fit(c, termBg, TEXT, toward);
  const tfg = t(s.fg[1]);
  const magenta = s.magenta ?? s.purple;
  const terminal: TerminalPalette = {
    background: bg2,
    foreground: tfg,
    cursor: tfg,
    selectionBackground: readableWash(bg2, s.blue, tfg, 0.3),
    black: dark ? bg0 : t(s.fg[0]),
    red: t(s.red), green: t(s.green), yellow: t(s.yellow), blue: t(s.blue),
    magenta: t(magenta), cyan: t(s.cyan), white: t(dark ? s.fg[1] : s.fg[1]),
    brightBlack: t(s.fg[3]),
    brightRed: t(mix(s.red, toward, 0.1)), brightGreen: t(mix(s.green, toward, 0.1)),
    brightYellow: t(mix(s.yellow, toward, 0.1)), brightBlue: t(mix(s.blue, toward, 0.1)),
    brightMagenta: t(mix(magenta, toward, 0.1)), brightCyan: t(mix(s.cyan, toward, 0.1)),
    brightWhite: t(s.fg[0]),
  };
  const search = {
    matchBackground: readableWash(bg2, s.blue, tfg, 0.35),
    matchOverviewRuler: t(s.blue),
    activeMatchBackground: readableWash(bg2, s.orange, tfg, 0.45),
    activeMatchColorOverviewRuler: t(s.orange),
  };
  return { vars, materials, terminal, search };
}

/** `bg` washed with `color` as strongly as `strength`, backed off until `fg` stays readable on it. */
function readableWash(bg: string, color: string, fg: string, strength: number): string {
  for (let k = strength; k > 0; k -= 0.02) {
    const c = mix(bg, color, k);
    if (contrastRatio(parseColor(fg), parseColor(c)) >= TEXT + 0.05) return c;
  }
  return bg;
}

const DERIVED = Object.fromEntries(
  (Object.keys(DEFS) as Exclude<PaletteId, 'argus'>[]).map((id) => [
    id,
    { dark: deriveTokens(DEFS[id].dark, 'dark'), light: deriveTokens(DEFS[id].light, 'light') },
  ]),
) as Record<Exclude<PaletteId, 'argus'>, Record<Mode, DerivedTheme>>;

/** The derived theme, or null for Argus (whose tokens live in tokens.css). */
export function derivedTheme(id: PaletteId, mode: Mode): DerivedTheme | null {
  return id === 'argus' ? null : DERIVED[id][mode];
}

/** Swatches for the picker: page, card, accent, then four syntax colors. */
export function paletteSwatches(id: PaletteId, mode: Mode, argus: { bg: string; card: string; accent: string; syn: string[] }): string[] {
  const d = derivedTheme(id, mode);
  if (!d) return [argus.bg, argus.card, argus.accent, ...argus.syn];
  const v = d.vars;
  return [v['--bg-1'], v['--bg-2'], v['--accent'], v['--syn-kw'], v['--syn-str'], v['--syn-fn'], v['--status-waiting']];
}

/**
 * One stylesheet with a rule per theme and mode. Its selectors outrank the
 * plain `[data-theme]` blocks in tokens.css, and an Increase Contrast rule is
 * repeated after them so muted text still steps up under that setting.
 */
export function paletteStylesheet(): string {
  const rules: string[] = [];
  for (const id of Object.keys(DERIVED) as Exclude<PaletteId, 'argus'>[]) {
    for (const mode of ['dark', 'light'] as const) {
      const body = Object.entries(DERIVED[id][mode].vars).map(([k, v]) => `  ${k}: ${v};`).join('\n');
      rules.push(`:root[data-palette="${id}"][data-theme="${mode}"] {\n${body}\n}`);
      const mat = Object.entries(DERIVED[id][mode].materials).map(([k, v]) => `  ${k}: ${v};`).join('\n');
      rules.push(`:root[data-palette="${id}"][data-theme="${mode}"][data-material="translucent"] {\n${mat}\n}`);
    }
  }
  rules.push(':root[data-palette][data-contrast="more"] { --fg-3: var(--fg-2); }');
  rules.push('@media (prefers-contrast: more) { :root[data-palette] { --fg-3: var(--fg-2); } }');
  return rules.join('\n');
}

const STYLE_ID = 'argus-palettes';

/** Inject the theme stylesheet once (idempotent). */
export function installPaletteStylesheet(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = paletteStylesheet();
  doc.head.appendChild(el);
}
