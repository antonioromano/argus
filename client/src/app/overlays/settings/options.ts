/**
 * Choice lists shared by the panes (to render) and the catalog (to label a value
 * in search, the Modified view and the palette). Plain data, no React, so the
 * catalog can import it without pulling in a pane.
 */
import type {
  ClaudeRenderer,
  Density,
  InspectorSide,
  MosaicOrientation,
  MosaicWaitingStyle,
  SessionViewMode,
  TileRunningIndicator,
} from '@argus/shared';
import type { ThemeMode } from '../../../context/theme-context.js';

export const THEME_OPTIONS: readonly { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];

/** Font-size presets (px). Defaults (Medium) match DEFAULT_CONFIG: code 13 / ui 14. */
export const DEFAULT_CODE_FONT_PX = 13;
export const DEFAULT_UI_FONT_PX = 14;

export const CODE_FONT_PRESETS = [
  { value: '11', label: 'Small' },
  { value: '13', label: 'Medium' },
  { value: '15', label: 'Large' },
  { value: '17', label: 'X-Large' },
] as const;

export const UI_FONT_PRESETS = [
  { value: '12', label: 'Small' },
  { value: '14', label: 'Medium' },
  { value: '16', label: 'Large' },
  { value: '18', label: 'X-Large' },
] as const;

/** Snap an unknown stored value to the default preset so the control always
 *  reflects real state rather than rendering nothing selected. */
export function fontPreset(presets: readonly { value: string }[], value: number | undefined, defaultPx: number): string {
  const px = String(value ?? defaultPx);
  return presets.some((p) => p.value === px) ? px : String(defaultPx);
}

export const LAYOUT_OPTIONS: readonly { value: MosaicOrientation; label: string }[] = [
  { value: 'horizontal', label: 'Side by side' },
  { value: 'vertical', label: 'Stacked' },
];

export const DENSITY_OPTIONS: readonly { value: Density; label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'default', label: 'Default' },
  { value: 'comfortable', label: 'Comfortable' },
];

export const WAITING_OPTIONS: readonly { value: MosaicWaitingStyle; label: string }[] = [
  { value: 'breathing', label: 'Breathing halo' },
  { value: 'flag', label: 'Pulse bar + flag' },
];

export const INSPECTOR_SIDE_OPTIONS: readonly { value: InspectorSide; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
];

export const INDICATOR_OPTIONS: readonly { value: TileRunningIndicator; label: string }[] = [
  { value: 'hairline', label: 'Hairline' },
  { value: 'off', label: 'Off' },
];

export type Backend = 'auto' | 'tmux';

export const BACKEND_OPTIONS: readonly { value: Backend; label: string; title: string }[] = [
  { value: 'auto', label: 'argusd', title: 'The Argus daemon — sessions survive app quit without tmux' },
  { value: 'tmux', label: 'tmux', title: 'The legacy backend — sessions live in a tmux server' },
];

export const RENDERER_OPTIONS: readonly { value: ClaudeRenderer; label: string; title: string }[] = [
  { value: 'fullscreen', label: 'Fullscreen', title: 'Claude redraws its own history on resize — no duplicated messages' },
  { value: 'classic', label: 'Classic', title: 'Terminal scrollback — resizing can leave duplicated messages' },
  { value: 'inherit', label: 'My setting', title: 'Use the tui value from your own Claude settings' },
];

export const RENDERER_HINT: Record<ClaudeRenderer, string> = {
  fullscreen: 'Claude keeps its own scrollback and re-lays it out when a tile resizes. Scroll, select and search inside Claude.',
  classic: 'Native terminal scrollback. Each width change makes Claude reprint its transcript, which can leave duplicated messages behind.',
  inherit: 'Argus adds nothing — the tui value in your ~/.claude/settings.json decides.',
};

export const VIEW_OPTIONS: readonly { value: SessionViewMode; label: string; title: string }[] = [
  { value: 'terminal', label: 'Terminal', title: 'Open Claude shells in the terminal' },
  { value: 'chat', label: 'Chat', title: 'Open Claude shells in the Chat view' },
];
