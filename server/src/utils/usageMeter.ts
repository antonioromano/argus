import type { AppConfig, UsageMeterPart, UsageMeterPartId, UsageWarnThresholds } from '@argus/shared';

/**
 * Usage meter config helpers. Server-side twin of the client's checks (server
 * code may only `import type` from shared, so the id list is repeated here).
 */
const PART_IDS: readonly UsageMeterPartId[] = ['ctx', 'plan', 'tok', 'model'];

/** An ordered list naming every part exactly once, each with a boolean `on`. */
export function isUsageMeterParts(v: unknown): v is UsageMeterPart[] {
  if (!Array.isArray(v) || v.length !== PART_IDS.length) return false;
  const seen = new Set<string>();
  for (const p of v) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
    const { id, on, ...rest } = p as { id?: unknown; on?: unknown };
    if (Object.keys(rest).length > 0) return false;
    if (typeof id !== 'string' || !(PART_IDS as readonly string[]).includes(id) || seen.has(id)) return false;
    if (typeof on !== 'boolean') return false;
    seen.add(id);
  }
  return true;
}

/** `{ amber, red }`: whole or fractional percents in 5..99, red above amber. */
export function isWarnThresholds(v: unknown): v is UsageWarnThresholds {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const { amber, red, ...rest } = v as { amber?: unknown; red?: unknown };
  if (Object.keys(rest).length > 0) return false;
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 5 && n <= 99;
  return ok(amber) && ok(red) && red > amber;
}

/** Whether the chip's Plan usage part is on (an absent or malformed list means the default: on). */
export function isPlanPartOn(config: Partial<AppConfig> | null | undefined): boolean {
  const parts = config?.usageMeterParts;
  if (!isUsageMeterParts(parts)) return true;
  return parts.find((p) => p.id === 'plan')?.on === true;
}
