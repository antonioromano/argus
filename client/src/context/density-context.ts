import { createContext, useContext } from 'react';
import type { Density } from '@argus/shared';
import { DENSITY_METRICS, DEFAULT_DENSITY, type DensityMetrics } from '../tokens/density.js';

export interface DensityContextValue extends DensityMetrics {
  density: Density;
}

export const DensityContext = createContext<DensityContextValue>({
  density: DEFAULT_DENSITY,
  ...DENSITY_METRICS[DEFAULT_DENSITY],
});

export function useDensity(): DensityContextValue {
  return useContext(DensityContext);
}
