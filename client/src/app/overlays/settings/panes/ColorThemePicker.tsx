import { Check } from 'lucide-react';
import { Icon } from '../../../../components/primitives/index.js';
import { PAINT_ACCENT_SURFACES, PAINT_SYNTAX } from '../../../../tokens/paint.js';
import { PALETTE_IDS, paletteLabel, paletteModeName, paletteSwatches, type Mode, type PaletteId } from '../../../../tokens/palettes.js';

/** Argus's own swatches, from the paint mirrors of tokens.css. */
function argusSwatches(mode: Mode) {
  const a = PAINT_ACCENT_SURFACES[mode];
  const s = PAINT_SYNTAX[mode];
  return { bg: a.panel, card: a.card, accent: a.brand, syn: [s.kw, s.str, s.fn, a.brand] };
}

interface ColorThemePickerProps {
  value: PaletteId;
  /** The appearance showing now; its half of each card is marked. */
  theme: Mode;
  onChange: (palette: PaletteId) => void;
  /** Swatches only, no half names: for the profile's one-screen Theme step. */
  compact?: boolean;
}

/**
 * One card per color theme: its name, the names of its dark and light halves,
 * and a strip of swatches for each (page, card, accent, keyword, string,
 * function, waiting). Appearance (System / Dark / Light) still decides which
 * half is on screen, so a pick here follows macOS when Appearance is System.
 */
export function ColorThemePicker({ value, theme, onChange, compact = false }: ColorThemePickerProps) {
  return (
    <div className="argus-theme-grid" data-compact={compact || undefined} role="group" aria-label="Color theme">
      {PALETTE_IDS.map((id) => {
        const selected = id === value;
        return (
          <button
            key={id}
            type="button"
            className="argus-theme-card"
            aria-pressed={selected}
            data-selected={selected || undefined}
            onClick={() => onChange(id)}
          >
            <span className="argus-theme-card-head">
              <span className="argus-theme-card-name">{paletteLabel(id)}</span>
              {selected && <Icon icon={Check} size="sm" />}
            </span>
            {(['dark', 'light'] as const).map((mode) => (
              <span key={mode} className="argus-theme-card-mode" data-current={mode === theme || undefined}>
                <span className="argus-theme-swatches" aria-hidden title={compact ? paletteModeName(id, mode) : undefined}>
                  {paletteSwatches(id, mode, argusSwatches(mode)).map((c, i) => (
                    <i key={i} style={{ background: c }} />
                  ))}
                </span>
                {!compact && <span className="argus-theme-card-sub">{paletteModeName(id, mode)}</span>}
              </span>
            ))}
          </button>
        );
      })}
    </div>
  );
}
