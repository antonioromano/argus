import { DEFAULT_CONFIG, INSPECTOR_WIDTH_MAX, INSPECTOR_WIDTH_MIN } from '@argus/shared';

export const INSPECTOR_WIDTH_DEFAULT = DEFAULT_CONFIG.inspectorWidth!;

/** A stored or dragged inspector width, kept inside the bounds the server enforces. */
export function clampInspectorWidth(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) return INSPECTOR_WIDTH_DEFAULT;
  return Math.round(Math.min(INSPECTOR_WIDTH_MAX, Math.max(INSPECTOR_WIDTH_MIN, n)));
}
