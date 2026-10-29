import { useLayoutEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { DensityContext, type DensityContextValue } from './density-context.js';
import { DENSITY_METRICS, DEFAULT_DENSITY, densityCssVars, isDensity } from '../tokens/density.js';

/**
 * Applies the Density setting (plan 008): `data-density` and the row-rhythm
 * custom properties on <html>, and the same numbers to JS consumers through
 * useDensity(). An unknown or absent value is Default.
 */
export function DensityProvider({ density, children }: { density?: unknown; children: ReactNode }) {
  const d = isDensity(density) ? density : DEFAULT_DENSITY;
  const value = useMemo<DensityContextValue>(() => ({ density: d, ...DENSITY_METRICS[d] }), [d]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const vars = densityCssVars(DENSITY_METRICS[d]);
    root.dataset.density = d;
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    return () => {
      delete root.dataset.density;
      for (const k of Object.keys(vars)) root.style.removeProperty(k);
    };
  }, [d]);

  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>;
}
