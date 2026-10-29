/**
 * Pure logic behind the renderer's macOS appearance attributes (plan 008):
 * which material the window shows, whether contrast is raised, whether the
 * window counts as active, and the system accent colour.
 *
 * No Electron import, so node:test can cover it. appearanceHost.ts gathers the
 * inputs from systemPreferences / nativeTheme / window state and pushes the
 * result to each window.
 */
import type { AppearanceSnapshot, WindowMaterial } from '@argus/shared';

/** macOS returns the accent as 'RRGGBBAA'. Normalise to '#rrggbb', or null. */
export function normalizeAccent(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(raw.trim());
  return m ? `#${m[1].toLowerCase()}` : null;
}

export interface AppearanceInput {
  accent: string | null;
  reduceTransparency: boolean;
  highContrast: boolean;
  fullscreen: boolean;
  windowActive: boolean;
  materialSetting: WindowMaterial;
}

/**
 * Every fallback lands on one value, `material: 'solid'`: Reduce
 * Transparency, Increase Contrast, fullscreen (vibrancy is dropped there, see
 * window.ts) and the user's own setting.
 */
export function composeAppearance(input: AppearanceInput): AppearanceSnapshot {
  const solid = input.reduceTransparency || input.highContrast || input.fullscreen || input.materialSetting === 'solid';
  return {
    accent: input.accent,
    material: solid ? 'solid' : 'translucent',
    contrast: input.highContrast ? 'more' : 'normal',
    active: input.windowActive,
  };
}

/**
 * A window is active when the app is frontmost and either it has OS focus or
 * it hosts the key native terminal overlay. A native tile is a child NSWindow
 * that takes key status, which leaves getFocusedWindow() null (see
 * menuTarget.ts); treating that as inactive would grey the whole UI whenever
 * the user types in a terminal.
 */
export function isWindowActive<W>(
  appActive: boolean,
  focused: W | null,
  win: W,
  keyOverlayOwners: Iterable<W | null | undefined>,
): boolean {
  if (!appActive) return false;
  if (focused) return focused === win;
  for (const owner of keyOverlayOwners) if (owner === win) return true;
  return false;
}
