// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PAINT_SURFACES, TERMINAL_THEMES, TERMINAL_SEARCH_DECORATIONS } from './paint.js';
import { GROUP_COLORS } from '../constants/groupColors.js';

// WCAG 2.1 AA guard for the color tokens. Every pair below is one the UI
// actually paints; if a token edit drops a pair under its threshold this fails
// and names the pair, the theme and the area it was audited for.

const TEXT = 4.5; // 1.4.3 — body text, including secondary/muted --fg-3
const UI = 3; //     1.4.11 — control edges, status dots, glyph markers

type Theme = 'dark' | 'light';
type Rgba = [number, number, number, number];

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

function themeBlock(theme: Theme): Record<string, string> {
  const head = theme === 'dark' ? /\[data-theme="dark"\]\s*\{/ : /\[data-theme="light"\]\s*\{/;
  const m = head.exec(css);
  if (!m) throw new Error(`no ${theme} block in tokens.css`);
  const body = css.slice(m.index + m[0].length, css.indexOf('}', m.index));
  const vars: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) vars[name] = value.trim();
  return vars;
}
const TOKENS: Record<Theme, Record<string, string>> = { dark: themeBlock('dark'), light: themeBlock('light') };

function parse(color: string): Rgba {
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

function over(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3];
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
}

function luminance([r, g, b]: Rgba): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(fg: Rgba, bg: Rgba): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Resolve a token (or a literal) for a theme. */
function color(theme: Theme, ref: string): Rgba {
  if (!ref.startsWith('--')) return parse(ref);
  const v = TOKENS[theme][ref];
  if (!v) throw new Error(`${ref} is not defined in the ${theme} block`);
  return v.startsWith('var(') ? color(theme, v.slice(4, -1)) : parse(v);
}

/** A color, possibly a translucent tint layered on an opaque surface. */
type Bg = string | [tint: string, surface: string];
function resolveBg(theme: Theme, bg: Bg): Rgba {
  if (typeof bg === 'string') return color(theme, bg);
  return over(color(theme, bg[0]), color(theme, bg[1]));
}

interface Pair { area: string; fg: Bg; bg: Bg; min: number }

const SURFACES = ['--bg-0', '--bg-1', '--bg-2', '--bg-3', '--bg-inset'];
const on = (area: string, fgs: string[], min: number, bgs: Bg[] = SURFACES): Pair[] =>
  fgs.flatMap((fg) => bgs.map((bg) => ({ area, fg, bg, min })));

const PAIRS: Pair[] = [
  // Chrome text everywhere: Mosaic tiles, Focus shell, explorer, Settings
  // rows, overlays/sheets (all sit on --bg-0..3), code wells (--bg-inset).
  ...on('text hierarchy', ['--fg-0', '--fg-1', '--fg-2', '--fg-3'], TEXT),
  ...on('disabled / decorative text', ['--fg-4'], UI),
  ...on('accent text (links, active nav, Remote URL)', ['--accent'], TEXT),
  ...on('semantic text', ['--danger', '--warn', '--info', '--ok', '--dirty'], TEXT),
  ...on('status labels', ['--status-waiting', '--status-running', '--status-idle', '--status-done', '--status-exited'], TEXT),
  ...on('agent glyphs / labels', ['--agent-claude', '--agent-gemini', '--agent-codex'], TEXT),
  ...on('syntax (markdown, mobile diff)', ['--syn-kw', '--syn-str', '--syn-num', '--syn-fn', '--syn-cm', '--syn-pn'], TEXT),

  // Chips: StatusPill, PR chip, Usage pill, Stale chip, DirtyBadge — tinted
  // fill over the card / panel they sit on.
  ...(['waiting', 'running', 'idle', 'done', 'exited'] as const).flatMap((s) =>
    on(`status chip (${s})`, [`--status-${s}`], TEXT, [[`--status-${s}-bg`, '--bg-1'], [`--status-${s}-bg`, '--bg-2'], [`--status-${s}-bg`, '--bg-3']])),
  ...on('danger chip / alert', ['--danger'], TEXT, [['--danger-bg', '--bg-1'], ['--danger-bg', '--bg-2']]),
  ...on('warn chip (Stale)', ['--warn'], TEXT, [['--warn-bg', '--bg-1'], ['--warn-bg', '--bg-2']]),
  ...on('dirty badge', ['--dirty'], TEXT, [['--dirty-bg', '--bg-1'], ['--dirty-bg', '--bg-2']]),
  ...on('accent chip (selected segment, PR chip)', ['--accent', '--fg-0'], TEXT, [['--accent-bg', '--bg-1'], ['--accent-bg', '--bg-2']]),
  ...on('mobile diff hunk header', ['--syn-fn'], TEXT, [['--info-bg', '--bg-inset']]),

  // Filled buttons and badges (primary / destructive confirm, mobile nav badge).
  ...on('primary button / nav badge', ['--fg-on-accent'], TEXT, ['--accent', '--status-waiting', '--status-done']),
  ...on('destructive confirm', ['--fg-on-danger'], TEXT, ['--danger']),
  ...on('switch knob (off)', ['--fg-2'], UI, ['--bg-3']),

  // Diff viewer (DiffViewer / SplitDiff).
  ...on('diff add row', ['--diff-add-fg', '--fg-1'], TEXT, ['--diff-add']),
  ...on('diff del row', ['--diff-del-fg', '--fg-1'], TEXT, ['--diff-del']),
  ...on('diff +/− marker', ['--diff-add-tok'], UI, ['--diff-add', '--bg-2']),
  ...on('diff +/− marker', ['--diff-del-tok'], UI, ['--diff-del', '--bg-2']),

  // UI boundaries: inputs, switches, checkboxes; keyboard focus ring.
  // A translucent edge is judged as composited over the surface it sits on.
  ...['--bg-1', '--bg-2', '--bg-3'].map((s): Pair => ({ area: 'form-control edge', fg: ['--line-control', s], bg: s, min: UI })),
  ...on('focus ring', ['--accent'], UI, ['--bg-0', '--bg-1', '--bg-2', '--bg-3']),
];

describe('color tokens meet WCAG AA', () => {
  for (const theme of ['dark', 'light'] as const) {
    const rows = PAIRS.map((p) => {
      const ratio = contrast(resolveBg(theme, p.fg), resolveBg(theme, p.bg));
      return { ...p, ratio: Math.round(ratio * 100) / 100 };
    });
    it(`${theme}: every audited pair clears its threshold`, () => {
      const failing = rows
        .filter((r) => r.ratio < r.min)
        .map((r) => `${r.area}: ${JSON.stringify(r.fg)} on ${JSON.stringify(r.bg)} = ${r.ratio} < ${r.min}`);
      expect(failing).toEqual([]);
    });
  }
});

describe('paint tokens (xterm / Monaco) mirror tokens.css', () => {
  for (const theme of ['dark', 'light'] as const) {
    it(`${theme}: terminal and inset surfaces equal --bg-2 / --bg-inset`, () => {
      expect(PAINT_SURFACES[theme].terminal.toLowerCase()).toBe(TOKENS[theme]['--bg-2'].toLowerCase());
      expect(PAINT_SURFACES[theme].inset.toLowerCase()).toBe(TOKENS[theme]['--bg-inset'].toLowerCase());
    });

    it(`${theme}: terminal palette is readable on its background`, () => {
      const t = TERMINAL_THEMES[theme];
      const bg = parse(t.background);
      // Dark `black` is the slot TUIs paint as a background, not as text.
      const skip = new Set(theme === 'dark' ? ['black'] : []);
      const failing = Object.entries(t)
        .filter(([k]) => !['background', 'selectionBackground', 'cursor'].includes(k) && !skip.has(k))
        .map(([k, v]) => [k, contrast(parse(v), bg)] as const)
        .filter(([, r]) => r < TEXT)
        .map(([k, r]) => `${k} = ${r.toFixed(2)}`);
      expect(failing).toEqual([]);
      expect(contrast(parse(t.foreground), parse(t.selectionBackground))).toBeGreaterThanOrEqual(TEXT);
    });

    it(`${theme}: search highlights keep the foreground readable`, () => {
      const fg = parse(TERMINAL_THEMES[theme].foreground);
      const d = TERMINAL_SEARCH_DECORATIONS[theme];
      expect(contrast(fg, parse(d.matchBackground))).toBeGreaterThanOrEqual(TEXT);
      expect(contrast(fg, parse(d.activeMatchBackground))).toBeGreaterThanOrEqual(TEXT);
    });
  }
});

describe('group colors', () => {
  it('every group swatch is visible (3:1) on the sidebar in its theme', () => {
    const failing = GROUP_COLORS.flatMap((g) =>
      (['dark', 'light'] as const)
        .map((theme) => [theme, contrast(parse(g[theme]), color(theme, '--bg-1'))] as const)
        .filter(([, r]) => r < UI)
        .map(([theme, r]) => `${g.key} (${theme}) = ${r.toFixed(2)}`),
    );
    expect(failing).toEqual([]);
  });
});

describe('input placeholders', () => {
  it('use the AA --fg-3 token at full opacity in both themes', () => {
    const interactions = readFileSync(new URL('./interactions.css', import.meta.url), 'utf8');
    const rules = [...interactions.matchAll(/([^{}]*::placeholder)\s*\{([^}]*)\}/g)];
    expect(rules.length).toBeGreaterThan(0);
    for (const [, selector, body] of rules) {
      const opacity = /opacity:\s*([\d.]+)/.exec(body);
      expect(opacity ? Number(opacity[1]) : 1, selector.trim()).toBe(1);
      const c = /(?:^|[\s;])color:\s*([^;]+);/.exec(body);
      if (c) expect(c[1].trim(), selector.trim()).toBe('var(--fg-3)');
    }
  });
});
