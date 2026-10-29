import { useEffect, useLayoutEffect, useState } from 'react';
import type { AppearanceSnapshot, WindowMaterial } from '@argus/shared';
import type { Theme } from '../context/theme-context.js';
import { pickFocusAccent } from '../utils/focusAccent.js';

/** The preload's `electronAppearance` bridge (absent in the browser and /mobile). */
export interface AppearanceBridge {
  snapshot(): unknown;
  onChange(cb: (snapshot: unknown) => void): () => void;
  setTheme(mode: 'dark' | 'light' | 'system'): void;
}

export function appearanceBridge(): AppearanceBridge | undefined {
  return (window as Window & { electronAppearance?: AppearanceBridge }).electronAppearance;
}

function isSnapshot(v: unknown): v is AppearanceSnapshot {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return (s.material === 'translucent' || s.material === 'solid')
    && (s.contrast === 'more' || s.contrast === 'normal')
    && typeof s.active === 'boolean'
    && (s.accent === null || typeof s.accent === 'string');
}

const ACCENT_VAR = '--sys-accent-color';

/**
 * Mirrors main's macOS appearance onto <html> (plan 008):
 * `data-material` (translucent | solid), `data-contrast` (more | normal),
 * `data-window-active` and `--sys-accent-color`. tokens.css does the rest.
 *
 * `windowMaterial` is the user's setting; it can only make the window solid.
 * Without the Electron bridge nothing is set, which tokens.css reads as solid.
 */
export function useSystemAppearance(theme: Theme, windowMaterial: WindowMaterial = 'translucent'): void {
  const [snap, setSnap] = useState<AppearanceSnapshot | null>(() => {
    const s = appearanceBridge()?.snapshot();
    return isSnapshot(s) ? s : null;
  });

  useEffect(() => {
    const bridge = appearanceBridge();
    if (!bridge) return;
    return bridge.onChange((s) => { if (isSnapshot(s)) setSnap(s); });
  }, []);

  // Layout effect: the attributes land before the first paint.
  useLayoutEffect(() => {
    if (!snap) return;
    const root = document.documentElement;
    root.dataset.material = windowMaterial === 'solid' ? 'solid' : snap.material;
    root.dataset.contrast = snap.contrast;
    root.dataset.windowActive = String(snap.active);
    const accent = pickFocusAccent(snap.accent, theme);
    if (accent) root.style.setProperty(ACCENT_VAR, accent);
    else root.style.removeProperty(ACCENT_VAR);
  }, [snap, theme, windowMaterial]);

  useLayoutEffect(() => () => {
    const root = document.documentElement;
    delete root.dataset.material;
    delete root.dataset.contrast;
    delete root.dataset.windowActive;
    root.style.removeProperty(ACCENT_VAR);
  }, []);
}
