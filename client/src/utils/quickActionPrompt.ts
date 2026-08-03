import type { AppConfig } from '@argus/shared';

/**
 * Whether to show the one-time quick-action picker.
 *
 * Gated on a *version string* rather than a boolean so a later release can
 * re-ask (by bumping the version it compares against) without a config
 * migration. An empty or absent value means "never asked".
 *
 * `version` is the running app version, which arrives asynchronously with the
 * update status — until it is known we hold the prompt back rather than write
 * an empty marker that would suppress it forever.
 */
export function shouldPromptQuickAction(
  config: Pick<AppConfig, 'quickActionPromptedAt'> | null | undefined,
  version: string | null | undefined,
): boolean {
  if (!config) return false;
  if (!version) return false;
  return !config.quickActionPromptedAt;
}
