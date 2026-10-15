import type { AppConfig, BetaFlag } from '@argus/shared';

/**
 * Whether a beta feature is switched on. Only an explicit `true` counts, so a
 * missing key (an older config file) or a malformed value leaves it off.
 * Server-side twin of client `utils/betaFlags` (server code may only
 * `import type` from shared, so the helper is not shared).
 */
export function isBetaEnabled(config: Partial<AppConfig> | null | undefined, flag: BetaFlag): boolean {
  return config?.[flag] === true;
}
